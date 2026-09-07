const asyncHandler = require('../../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/apiResponse');
const Building = require('../../models/Building.model');
const Floor    = require('../../models/Floor.model');
const Room     = require('../../models/Room.model');
const Bed      = require('../../models/Bed.model');
const PG       = require('../../models/PG.model');

// ─── Stats Sync Helper ───────────────────────────────────────────────────────
/**
 * Recompute and persist Building & Floor stats from actual Room/Bed data.
 * Call after any Room or Bed mutation.
 */
const syncBuildingFloorStats = async (buildingId, floorId) => {
  if (floorId) {
    const [floorStats] = await Bed.aggregate([
      { $match: { floor: floorId } },
      {
        $group: {
          _id: null,
          totalBeds:    { $sum: 1 },
          occupiedBeds: { $sum: { $cond: [{ $eq: ['$status', 'occupied'] }, 1, 0] } },
          vacantBeds:   { $sum: { $cond: [{ $eq: ['$status', 'vacant'] },   1, 0] } },
        },
      },
    ]);
    const totalRooms = await Room.countDocuments({ floor: floorId });
    await Floor.findByIdAndUpdate(floorId, {
      'stats.totalRooms':   totalRooms,
      'stats.totalBeds':    floorStats?.totalBeds || 0,
      'stats.occupiedBeds': floorStats?.occupiedBeds || 0,
      'stats.vacantBeds':   floorStats?.vacantBeds || 0,
    });
  }
  if (buildingId) {
    const [buildingStats] = await Bed.aggregate([
      { $match: { building: buildingId } },
      {
        $group: {
          _id: null,
          totalBeds:    { $sum: 1 },
          occupiedBeds: { $sum: { $cond: [{ $eq: ['$status', 'occupied'] }, 1, 0] } },
          vacantBeds:   { $sum: { $cond: [{ $eq: ['$status', 'vacant'] },   1, 0] } },
        },
      },
    ]);
    const totalRooms = await Room.countDocuments({ building: buildingId });
    await Building.findByIdAndUpdate(buildingId, {
      'stats.totalRooms':   totalRooms,
      'stats.totalBeds':    buildingStats?.totalBeds || 0,
      'stats.occupiedBeds': buildingStats?.occupiedBeds || 0,
      'stats.vacantBeds':   buildingStats?.vacantBeds || 0,
    });
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const assertOwnsBuilding = async (buildingId, ownerId) => {
  const building = await Building.findOne({ _id: buildingId, owner: ownerId });
  if (!building) throw { status: 404, message: 'Building not found or access denied' };
  return building;
};

// ─── Create Building ──────────────────────────────────────────────────────────
exports.createBuilding = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const building = await Building.create({
    pg: pgId,
    owner: ownerId,
    ...req.body,
  });

  return successResponse(res, 'Building created successfully', building, 201);
});

exports.getBuildings = asyncHandler(async (req, res) => {
  const { pgId }  = req.params;
  const ownerId   = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  if (req.query.page) {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip  = (page - 1) * limit;

    const [buildings, total] = await Promise.all([
      Building.find({ pg: pgId, owner: ownerId }).sort({ createdAt: 1 }).skip(skip).limit(limit),
      Building.countDocuments({ pg: pgId, owner: ownerId }),
    ]);

    return paginatedResponse(res, 'Buildings fetched', buildings, {
      page, limit, total, pages: Math.ceil(total / limit),
    });
  }

  const buildings = await Building.find({ pg: pgId, owner: ownerId }).sort({ createdAt: 1 });
  return successResponse(res, 'Buildings fetched', buildings);
});

// ─── Get Single Building ──────────────────────────────────────────────────────
exports.getBuilding = asyncHandler(async (req, res) => {
  const building = await assertOwnsBuilding(req.params.id, req.user._id);
  return successResponse(res, 'Building fetched', building);
});

// ─── Update Building ──────────────────────────────────────────────────────────
exports.updateBuilding = asyncHandler(async (req, res) => {
  const building = await assertOwnsBuilding(req.params.id, req.user._id);

  const ALLOWED = ['name', 'description', 'totalFloors', 'status', 'address'];
  ALLOWED.forEach((key) => {
    if (req.body[key] !== undefined) building[key] = req.body[key];
  });

  await building.save();
  return successResponse(res, 'Building updated', building);
});

// ─── Delete Building ──────────────────────────────────────────────────────────
exports.deleteBuilding = asyncHandler(async (req, res) => {
  const building = await assertOwnsBuilding(req.params.id, req.user._id);

  // Guard: prevent deletion if floors/rooms exist
  const floorCount = await Floor.countDocuments({ building: building._id });
  if (floorCount > 0) {
    return errorResponse(res, `Cannot delete building with ${floorCount} floor(s). Remove floors first.`, 400);
  }

  await building.deleteOne();
  return successResponse(res, 'Building deleted');
});

// ─── Floor CRUD ───────────────────────────────────────────────────────────────
exports.createFloor = asyncHandler(async (req, res) => {
  const building = await assertOwnsBuilding(req.params.buildingId, req.user._id);

  const floor = await Floor.create({
    building: building._id,
    pg:       building.pg,
    owner:    req.user._id,
    ...req.body,
  });

  return successResponse(res, 'Floor created', floor, 201);
});

exports.getFloors = asyncHandler(async (req, res) => {
  await assertOwnsBuilding(req.params.buildingId, req.user._id);
  const floors = await Floor.find({ building: req.params.buildingId }).sort({ floorNumber: 1 });
  return successResponse(res, 'Floors fetched', floors);
});

exports.updateFloor = asyncHandler(async (req, res) => {
  const floor = await Floor.findOne({ _id: req.params.id, owner: req.user._id });
  if (!floor) return errorResponse(res, 'Floor not found or access denied', 404);

  const ALLOWED = ['name', 'floorNumber', 'status'];
  ALLOWED.forEach((key) => { if (req.body[key] !== undefined) floor[key] = req.body[key]; });

  await floor.save();
  return successResponse(res, 'Floor updated', floor);
});

exports.deleteFloor = asyncHandler(async (req, res) => {
  const floor = await Floor.findOne({ _id: req.params.id, owner: req.user._id });
  if (!floor) return errorResponse(res, 'Floor not found or access denied', 404);

  const roomCount = await Room.countDocuments({ floor: floor._id });
  if (roomCount > 0) {
    return errorResponse(res, `Cannot delete floor with ${roomCount} room(s). Remove rooms first.`, 400);
  }

  await floor.deleteOne();
  return successResponse(res, 'Floor deleted');
});

// ─── Room CRUD ────────────────────────────────────────────────────────────────
exports.createRoom = asyncHandler(async (req, res) => {
  const floor = await Floor.findOne({ _id: req.params.floorId, owner: req.user._id });
  if (!floor) return errorResponse(res, 'Floor not found or access denied', 404);

  const room = await Room.create({
    floor:    floor._id,
    building: floor.building,
    pg:       floor.pg,
    owner:    req.user._id,
    ...req.body,
  });

  // Auto-create beds based on totalBeds
  if (room.totalBeds > 0) {
    const bedLabels = Array.from({ length: room.totalBeds }, (_, i) =>
      String.fromCharCode(65 + i) // A, B, C ...
    );
    const beds = bedLabels.map((label) => ({
      room:     room._id,
      floor:    floor._id,
      building: floor.building,
      pg:       floor.pg,
      owner:    req.user._id,
      bedLabel: label,
      status:   'vacant',
    }));
    await Bed.insertMany(beds);

    // Update room vacancy counters
    room.vacantBeds = room.totalBeds;
    await room.save();
  }

  // Sync parent stats
  await syncBuildingFloorStats(floor.building, floor._id);

  return successResponse(res, 'Room created with beds', room, 201);
});

exports.getRooms = asyncHandler(async (req, res) => {
  const floor = await Floor.findOne({ _id: req.params.floorId, owner: req.user._id });
  if (!floor) return errorResponse(res, 'Floor not found or access denied', 404);

  const rooms = await Room.find({ floor: req.params.floorId }).sort({ roomNumber: 1 });
  return successResponse(res, 'Rooms fetched', rooms);
});

exports.getRoom = asyncHandler(async (req, res) => {
  const room = await Room.findOne({ _id: req.params.id, owner: req.user._id });
  if (!room) return errorResponse(res, 'Room not found or access denied', 404);

  const beds = await Bed.find({ room: room._id }).sort({ bedLabel: 1 });
  return successResponse(res, 'Room fetched', { room, beds });
});

exports.updateRoom = asyncHandler(async (req, res) => {
  const room = await Room.findOne({ _id: req.params.id, owner: req.user._id });
  if (!room) return errorResponse(res, 'Room not found or access denied', 404);

  const ALLOWED = ['roomNumber', 'shareType', 'rentPerBed', 'status', 'amenities', 'notes'];
  ALLOWED.forEach((key) => { if (req.body[key] !== undefined) room[key] = req.body[key]; });

  await room.save();
  return successResponse(res, 'Room updated', room);
});

exports.deleteRoom = asyncHandler(async (req, res) => {
  const room = await Room.findOne({ _id: req.params.id, owner: req.user._id });
  if (!room) return errorResponse(res, 'Room not found or access denied', 404);

  const occupiedBeds = await Bed.countDocuments({ room: room._id, status: 'occupied' });
  if (occupiedBeds > 0) {
    return errorResponse(res, `Cannot delete room with ${occupiedBeds} occupied bed(s).`, 400);
  }

  const { building, floor } = room;
  await Bed.deleteMany({ room: room._id });
  await room.deleteOne();

  // Sync parent stats
  await syncBuildingFloorStats(building, floor);

  return successResponse(res, 'Room and its beds deleted');
});

// ─── Bed Operations ───────────────────────────────────────────────────────────
exports.updateBed = asyncHandler(async (req, res) => {
  const bed = await Bed.findOne({ _id: req.params.id, owner: req.user._id });
  if (!bed) return errorResponse(res, 'Bed not found or access denied', 404);

  const ALLOWED = ['bedLabel', 'status', 'rentOverride', 'notes'];
  ALLOWED.forEach((key) => { if (req.body[key] !== undefined) bed[key] = req.body[key]; });

  await bed.save();

  // Sync parent stats on status change
  await syncBuildingFloorStats(bed.building, bed.floor);

  return successResponse(res, 'Bed updated', bed);
});

// ─── List Beds for a Room ─────────────────────────────────────────────────────
exports.getBeds = asyncHandler(async (req, res) => {
  const room = await Room.findOne({ _id: req.params.roomId, owner: req.user._id });
  if (!room) return errorResponse(res, 'Room not found or access denied', 404);

  const beds = await Bed.find({ room: room._id })
    .populate('currentTenant', 'name phone')
    .sort({ bedLabel: 1 });

  return successResponse(res, 'Beds fetched', beds);
});

// ─── Property Hierarchy (efficient loading for mobile) ────────────────────────
exports.getPropertyHierarchy = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId }).select('_id name city area');
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const buildings = await Building.find({ pg: pgId, owner: ownerId }).sort({ createdAt: 1 }).lean();

  // For each building, fetch floors with rooms and beds
  const hierarchy = await Promise.all(
    buildings.map(async (building) => {
      const floors = await Floor.find({ building: building._id }).sort({ floorNumber: 1 }).lean();
      const floorsWithRooms = await Promise.all(
        floors.map(async (floor) => {
          const rooms = await Room.find({ floor: floor._id }).sort({ roomNumber: 1 }).lean();
          const roomsWithBeds = await Promise.all(
            rooms.map(async (room) => {
              const beds = await Bed.find({ room: room._id })
                .populate('currentTenant', 'name phone')
                .sort({ bedLabel: 1 })
                .lean();
              return { ...room, beds };
            })
          );
          return { ...floor, rooms: roomsWithBeds };
        })
      );
      return { ...building, floors: floorsWithRooms };
    })
  );

  return successResponse(res, 'Property hierarchy fetched', { pg, buildings: hierarchy });
});

// ─── Availability Overview ────────────────────────────────────────────────────
exports.getAvailability = asyncHandler(async (req, res) => {
  const { pgId } = req.params;
  const ownerId  = req.user._id;

  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) return errorResponse(res, 'PG not found or access denied', 404);

  const [summary] = await Bed.aggregate([
    { $match: { pg: pg._id, owner: ownerId } },
    {
      $group: {
        _id:            null,
        total:          { $sum: 1 },
        vacant:         { $sum: { $cond: [{ $eq: ['$status', 'vacant'] },      1, 0] } },
        occupied:       { $sum: { $cond: [{ $eq: ['$status', 'occupied'] },    1, 0] } },
        reserved:       { $sum: { $cond: [{ $eq: ['$status', 'reserved'] },    1, 0] } },
        maintenance:    { $sum: { $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0] } },
      },
    },
  ]);

  const byBuilding = await Bed.aggregate([
    { $match: { pg: pg._id, owner: ownerId } },
    {
      $group: {
        _id:       '$building',
        total:     { $sum: 1 },
        vacant:    { $sum: { $cond: [{ $eq: ['$status', 'vacant'] },   1, 0] } },
        occupied:  { $sum: { $cond: [{ $eq: ['$status', 'occupied'] }, 1, 0] } },
      },
    },
  ]);

  return successResponse(res, 'Availability fetched', {
    overall:    summary || { total: 0, vacant: 0, occupied: 0, reserved: 0, maintenance: 0 },
    byBuilding,
  });
});

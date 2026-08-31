const mongoose = require('mongoose');
const Meetup = require('../models/Meetup.model');
const MeetupCategory = require('../models/MeetupCategory.model');
const MeetupParticipant = require('../models/MeetupParticipant.model');
const uploadService = require('./upload.service');
const {
  MIN_MEETUP_IMAGES,
  MAX_MEETUP_IMAGES,
  syncBannerFromImages,
  isMeetupLive,
  resolveRefId,
} = require('../utils/meetupHelpers');

// ─── Constants ────────────────────────────────────────────────────────────────

const PROTECTED_UPDATE_FIELDS = [
  '_id', 'id', 'createdBy', 'legacyRsvpList', 'analytics',
  'createdAt', 'updatedAt', '__v', 'isAdminApproved', 'status',
];

const LIVE_QUERY = { status: 'published', isAdminApproved: true };

const BASE_POPULATE = [
  { path: 'createdBy',   select: 'name email role' },
  { path: 'organizer.pg', select: 'name city area' },
];

// ─── Safe Category Populator ─────────────────────────────────────────────────
/**
 * Safely populates categories & subcategories for an array of meetup docs.
 * Supports both valid MeetupCategory ObjectIds and legacy string category names (e.g. "community").
 * Completely immune to Mongoose ObjectId CastErrors on legacy data.
 */
const batchPopulateCategories = async (meetups) => {
  if (!Array.isArray(meetups) || meetups.length === 0) return [];

  // Extract all valid ObjectIds for categories & subcategories
  const catIdsToFetch = new Set();
  meetups.forEach((m) => {
    if (m.category && mongoose.Types.ObjectId.isValid(m.category)) {
      catIdsToFetch.add(m.category.toString());
    }
    if (m.subcategory && mongoose.Types.ObjectId.isValid(m.subcategory)) {
      catIdsToFetch.add(m.subcategory.toString());
    }
  });

  // Fetch category docs in 1 single query
  const categoryMap = {};
  if (catIdsToFetch.size > 0) {
    try {
      const fetchedCategories = await MeetupCategory.find({
        _id: { $in: Array.from(catIdsToFetch) },
      })
        .select('name slug icon color displayName')
        .lean();

      fetchedCategories.forEach((c) => {
        categoryMap[c._id.toString()] = c;
      });
    } catch (_) {
      // Non-fatal fallback
    }
  }

  // Attach category and subcategory objects to each meetup
  return meetups.map((m) => {
    const doc = { ...m };

    // Process Category
    if (doc.category) {
      if (typeof doc.category === 'object' && doc.category.name) {
        // Already populated
      } else if (mongoose.Types.ObjectId.isValid(doc.category) && categoryMap[doc.category.toString()]) {
        doc.category = categoryMap[doc.category.toString()];
      } else if (typeof doc.category === 'string') {
        const raw = doc.category;
        doc.category = {
          _id: raw,
          name: raw,
          displayName: raw.charAt(0).toUpperCase() + raw.slice(1),
          slug: raw.toLowerCase(),
          icon: '🎯',
          color: '#4f46e5',
        };
      }
    } else if (doc.legacyCategory) {
      const raw = doc.legacyCategory;
      doc.category = {
        _id: raw,
        name: raw,
        displayName: raw.charAt(0).toUpperCase() + raw.slice(1),
        slug: raw.toLowerCase(),
        icon: '🎯',
        color: '#4f46e5',
      };
    }

    // Process Subcategory
    if (doc.subcategory) {
      if (typeof doc.subcategory === 'object' && doc.subcategory.name) {
        // Already populated
      } else if (mongoose.Types.ObjectId.isValid(doc.subcategory) && categoryMap[doc.subcategory.toString()]) {
        doc.subcategory = categoryMap[doc.subcategory.toString()];
      } else if (typeof doc.subcategory === 'string') {
        const raw = doc.subcategory;
        doc.subcategory = {
          _id: raw,
          name: raw,
          displayName: raw.charAt(0).toUpperCase() + raw.slice(1),
          slug: raw.toLowerCase(),
        };
      }
    }

    return doc;
  });
};

// ─── Permission Helpers ───────────────────────────────────────────────────────

const canManageMeetup = (meetup, userId, role) => {
  if (role === 'admin') return true;
  if (!userId) return false;
  return resolveRefId(meetup.createdBy) === userId.toString();
};

const canViewMeetup = (meetup, userId, role) => {
  if (isMeetupLive(meetup)) return true;
  if (role === 'admin') return true;
  if (!userId) return false;
  return resolveRefId(meetup.createdBy) === userId.toString();
};

// ─── Analytics Sync ──────────────────────────────────────────────────────────
const syncParticipantCounts = async (meetupId) => {
  const [interestedCount, goingCount] = await Promise.all([
    MeetupParticipant.countDocuments({ meetup: meetupId, status: 'interested' }),
    MeetupParticipant.countDocuments({
      meetup: meetupId,
      status: { $in: ['approved', 'confirmed', 'attended'] },
    }),
  ]);

  await Meetup.findByIdAndUpdate(meetupId, {
    $set: {
      'analytics.interestedCount': interestedCount,
      'analytics.goingCount': goingCount,
    },
  });

  return { interestedCount, goingCount };
};

// ─── 1. Discovery Sections ────────────────────────────────────────────────────
const getDiscoverySections = async (params = {}) => {
  const { city, area, lat, lng, categoryId, radius = 20000 } = params;

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  const base = { ...LIVE_QUERY };
  if (city) base['location.city'] = { $regex: new RegExp(city, 'i') };
  if (area) {
    const areas = String(area)
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (areas.length === 1) {
      base['location.area'] = { $regex: new RegExp(`^${areas[0]}$`, 'i') };
    } else if (areas.length > 1) {
      base['location.area'] = { $in: areas.map((a) => new RegExp(`^${a}$`, 'i')) };
    }
  }
  if (categoryId) base.category = categoryId;

  // Nearby geo query
  const nearbyPromise = (lat && lng)
    ? Meetup.find({
        ...base,
        startDate: { $gte: now },
        'location.coordinates': {
          $near: {
            $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
            $maxDistance: radius,
          },
        },
      })
        .populate(BASE_POPULATE)
        .limit(10)
        .lean()
    : Promise.resolve([]);

  const todayPromise = Meetup.find({
    ...base,
    startDate: { $gte: todayStart, $lte: todayEnd },
  })
    .populate(BASE_POPULATE)
    .sort({ 'analytics.goingCount': -1 })
    .limit(10)
    .lean();

  const newPromise = Meetup.find({ ...base, startDate: { $gte: now } })
    .populate(BASE_POPULATE)
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const popularPromise = Meetup.find({ ...base, startDate: { $gte: now } })
    .populate(BASE_POPULATE)
    .sort({ 'analytics.goingCount': -1, 'analytics.interestedCount': -1 })
    .limit(10)
    .lean();

  const onlinePromise = Meetup.find({
    ...base,
    startDate: { $gte: now },
    locationType: { $in: ['online', 'hybrid'] },
  })
    .populate(BASE_POPULATE)
    .sort({ startDate: 1 })
    .limit(10)
    .lean();

  const freePromise = Meetup.find({
    ...base,
    startDate: { $gte: now },
    'participation.isFree': true,
  })
    .populate(BASE_POPULATE)
    .sort({ startDate: 1 })
    .limit(10)
    .lean();

  const lookingPromise = Meetup.find({
    ...base,
    startDate: { $gte: now },
    'participation.registrationType': 'open',
    $or: [
      { 'participation.capacity': null },
      { $expr: { $lt: ['$analytics.goingCount', '$participation.capacity'] } },
    ],
  })
    .populate(BASE_POPULATE)
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const featuredPromise = Meetup.find({
    ...base,
    isFeatured: true,
    startDate: { $gte: now },
    $or: [{ featuredUntil: null }, { featuredUntil: { $gte: now } }],
  })
    .populate(BASE_POPULATE)
    .sort({ startDate: 1 })
    .limit(10)
    .lean();

  const [nearby, today, newlyCreated, popular, online, free, lookingForPeople, featured] =
    await Promise.all([
      nearbyPromise, todayPromise, newPromise, popularPromise,
      onlinePromise, freePromise, lookingPromise, featuredPromise,
    ]);

  const [
    popNearby, popToday, popNewly, popPopular,
    popOnline, popFree, popLooking, popFeatured
  ] = await Promise.all([
    batchPopulateCategories(nearby),
    batchPopulateCategories(today),
    batchPopulateCategories(newlyCreated),
    batchPopulateCategories(popular),
    batchPopulateCategories(online),
    batchPopulateCategories(free),
    batchPopulateCategories(lookingForPeople),
    batchPopulateCategories(featured),
  ]);

  return {
    sections: [
      { key: 'featured',         title: 'Featured',               meetups: popFeatured },
      { key: 'nearby',           title: 'Happening Near You',     meetups: popNearby },
      { key: 'today',            title: 'Today',                  meetups: popToday },
      { key: 'popular',          title: 'Popular Right Now',      meetups: popPopular },
      { key: 'new',              title: 'Newly Created',          meetups: popNewly },
      { key: 'online',           title: 'Join Online',            meetups: popOnline },
      { key: 'free',             title: 'Free to Join',           meetups: popFree },
      { key: 'lookingForPeople', title: 'Looking for People',     meetups: popLooking },
    ].filter((s) => s.meetups.length > 0),
  };
};

// ─── 2. Paginated Public List ─────────────────────────────────────────────────
const getMeetups = async (params = {}) => {
  const {
    category, subcategory, city, area, locationType,
    isFree, scheduleType, dateFrom, dateTo,
    page = 1, limit = 12, sort = 'startDate',
  } = params;

  const query = { ...LIVE_QUERY };
  if (category)     query.category = category;
  if (subcategory)  query.subcategory = subcategory;
  if (city)         query['location.city'] = { $regex: new RegExp(city, 'i') };
  if (area)         query['location.area'] = { $regex: new RegExp(area, 'i') };
  if (locationType) query.locationType = locationType;
  if (isFree !== undefined) query['participation.isFree'] = isFree === 'true' || isFree === true;
  if (scheduleType) query.scheduleType = scheduleType;
  if (dateFrom || dateTo) {
    query.startDate = {};
    if (dateFrom) query.startDate.$gte = new Date(dateFrom);
    if (dateTo)   query.startDate.$lte = new Date(dateTo);
  }

  const parsedPage  = Math.max(1, parseInt(page, 10));
  const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10)));
  const skip = (parsedPage - 1) * parsedLimit;

  const sortMap = {
    startDate: { startDate: 1 },
    popular:   { 'analytics.goingCount': -1 },
    newest:    { createdAt: -1 },
  };
  const sortSpec = sortMap[sort] || sortMap.startDate;

  const [rawMeetups, total] = await Promise.all([
    Meetup.find(query)
      .populate(BASE_POPULATE)
      .sort(sortSpec)
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Meetup.countDocuments(query),
  ]);

  const meetups = await batchPopulateCategories(rawMeetups);

  return {
    meetups,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages: Math.ceil(total / parsedLimit),
    },
  };
};

// ─── 3. Nearby ────────────────────────────────────────────────────────────────
const getNearbyMeetups = async ({ lat, lng, radius = 20000, limit = 20 }) => {
  if (!lat || !lng) {
    const err = new Error('lat and lng are required for nearby search');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  const rawMeetups = await Meetup.find({
    ...LIVE_QUERY,
    startDate: { $gte: now },
    'location.coordinates': {
      $near: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseInt(radius, 10),
      },
    },
  })
    .populate(BASE_POPULATE)
    .limit(parseInt(limit, 10))
    .lean();

  const meetups = await batchPopulateCategories(rawMeetups);
  return { meetups };
};

// ─── 4. Upcoming ─────────────────────────────────────────────────────────────
const getUpcomingMeetups = async (limit = 10) => {
  const now = new Date();
  const rawMeetups = await Meetup.find({ ...LIVE_QUERY, startDate: { $gte: now } })
    .populate(BASE_POPULATE)
    .sort({ startDate: 1 })
    .limit(parseInt(limit, 10))
    .lean();

  const meetups = await batchPopulateCategories(rawMeetups);
  return { meetups };
};

// ─── 5. Get by ID ─────────────────────────────────────────────────────────────
const getMeetupById = async (id, viewer = null) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const err = new Error('Invalid Meetup ID format');
    err.statusCode = 400;
    throw err;
  }

  const rawMeetup = await Meetup.findById(id)
    .populate(BASE_POPULATE)
    .populate('location.cityId', 'name slug')
    .lean();

  if (!rawMeetup) {
    const err = new Error('Meetup not found');
    err.statusCode = 404;
    throw err;
  }

  const [meetup] = await batchPopulateCategories([rawMeetup]);

  const viewerId   = viewer?._id || viewer?.id;
  const viewerRole = viewer?.role;

  if (!canViewMeetup(meetup, viewerId, viewerRole)) {
    const err = new Error(viewerId ? 'You do not have permission to view this meetup' : 'Meetup not found');
    err.statusCode = viewerId ? 403 : 404;
    throw err;
  }

  if (isMeetupLive(meetup)) {
    Meetup.findByIdAndUpdate(id, { $inc: { 'analytics.views': 1 } }).exec().catch(() => {});
  }

  let myParticipation = null;
  if (viewerId) {
    myParticipation = await MeetupParticipant.findOne({
      meetup: id,
      user: viewerId,
    }).lean();
  }

  return { meetup, myParticipation };
};

const sanitizeCoordinates = (obj) => {
  if (obj?.location?.coordinates) {
    const coords = obj.location.coordinates.coordinates;
    if (
      !Array.isArray(coords) ||
      coords.length !== 2 ||
      typeof coords[0] !== 'number' ||
      typeof coords[1] !== 'number' ||
      isNaN(coords[0]) ||
      isNaN(coords[1])
    ) {
      delete obj.location.coordinates;
    }
  }
  return obj;
};

// ─── 6. Create ────────────────────────────────────────────────────────────────
const createMeetup = async (userId, data) => {
  const safe = Object.fromEntries(
    Object.entries(data).filter(([k]) => !PROTECTED_UPDATE_FIELDS.includes(k))
  );

  sanitizeCoordinates(safe);

  const meetup = new Meetup({
    ...safe,
    createdBy:       userId,
    status:          'draft',
    isAdminApproved: false,
  });

  await meetup.save();
  return { meetup };
};

// ─── 7. Update ────────────────────────────────────────────────────────────────
const updateMeetup = async (meetupId, userId, role, data) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) { const e = new Error('Meetup not found'); e.statusCode = 404; throw e; }
  if (!canManageMeetup(meetup, userId, role)) { const e = new Error('Unauthorized'); e.statusCode = 403; throw e; }

  const wasLive = isMeetupLive(meetup);
  const safeData = sanitizeCoordinates({ ...data });

  Object.keys(safeData).forEach((key) => {
    if (PROTECTED_UPDATE_FIELDS.includes(key)) return;
    meetup[key] = safeData[key];
  });

  if (wasLive && role !== 'admin') {
    meetup.status = 'submitted';
    meetup.isAdminApproved = false;
  }

  await meetup.save();
  return { meetup };
};

// ─── 8. Delete ────────────────────────────────────────────────────────────────
const deleteMeetup = async (meetupId, userId, role) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) { const e = new Error('Meetup not found'); e.statusCode = 404; throw e; }
  if (!canManageMeetup(meetup, userId, role)) { const e = new Error('Unauthorized'); e.statusCode = 403; throw e; }

  const publicIds = (meetup.images || []).map((i) => i.publicId).filter(Boolean);
  if (meetup.bannerImage?.publicId) publicIds.push(meetup.bannerImage.publicId);
  if (publicIds.length) {
    await uploadService.deleteAssets([...new Set(publicIds)], 'image');
  }

  await MeetupParticipant.deleteMany({ meetup: meetupId });
  await Meetup.findByIdAndDelete(meetupId);
  return true;
};

// ─── 9. Submit for Approval ───────────────────────────────────────────────────
const submitMeetup = async (meetupId, userId, role) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) { const e = new Error('Meetup not found'); e.statusCode = 404; throw e; }
  if (!canManageMeetup(meetup, userId, role)) { const e = new Error('Unauthorized'); e.statusCode = 403; throw e; }

  if (!['draft', 'submitted'].includes(meetup.status)) {
    const e = new Error('Only draft meetups can be submitted for approval');
    e.statusCode = 400;
    throw e;
  }
  if ((meetup.images?.length || 0) < MIN_MEETUP_IMAGES) {
    const e = new Error(`Upload at least ${MIN_MEETUP_IMAGES} photos before submitting`);
    e.statusCode = 400;
    throw e;
  }

  meetup.status = 'submitted';
  meetup.isAdminApproved = false;
  await meetup.save();
  return { meetup };
};

// ─── 10. Image Management ─────────────────────────────────────────────────────
const uploadMeetupImages = async (meetupId, userId, role, files, setMain = false) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) { const e = new Error('Meetup not found'); e.statusCode = 404; throw e; }
  if (!canManageMeetup(meetup, userId, role)) { const e = new Error('Unauthorized'); e.statusCode = 403; throw e; }

  const currentCount = meetup.images?.length || 0;
  if (currentCount + files.length > MAX_MEETUP_IMAGES) {
    const e = new Error(`Maximum ${MAX_MEETUP_IMAGES} photos allowed`);
    e.statusCode = 400;
    throw e;
  }

  const uploaded = await uploadService.uploadImages(files, 'pginfo/meetup-photos');

  if ((setMain || currentCount === 0) && uploaded.length > 0) {
    meetup.images.forEach((img) => { img.isMain = false; });
    uploaded[0].isMain = true;
  }

  meetup.images.push(...uploaded);
  syncBannerFromImages(meetup);

  if (isMeetupLive(meetup) && role !== 'admin') {
    meetup.status = 'submitted';
    meetup.isAdminApproved = false;
  }

  await meetup.save();
  return { meetup, images: uploaded };
};

const deleteMeetupImage = async (meetupId, userId, role, publicId) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) { const e = new Error('Meetup not found'); e.statusCode = 404; throw e; }
  if (!canManageMeetup(meetup, userId, role)) { const e = new Error('Unauthorized'); e.statusCode = 403; throw e; }

  const image = meetup.images.find((img) => img.publicId === publicId);
  if (!image) { const e = new Error('Image not found'); e.statusCode = 404; throw e; }

  await uploadService.deleteAssets([publicId], 'image');
  meetup.images = meetup.images.filter((img) => img.publicId !== publicId);

  if (image.isMain && meetup.images.length > 0) {
    meetup.images[0].isMain = true;
  }
  syncBannerFromImages(meetup);

  if (isMeetupLive(meetup) && role !== 'admin') {
    meetup.status = 'submitted';
    meetup.isAdminApproved = false;
  }

  await meetup.save();
  return { meetup };
};

const setMainMeetupImage = async (meetupId, userId, role, publicId) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) { const e = new Error('Meetup not found'); e.statusCode = 404; throw e; }
  if (!canManageMeetup(meetup, userId, role)) { const e = new Error('Unauthorized'); e.statusCode = 403; throw e; }

  const target = meetup.images.find((img) => img.publicId === publicId);
  if (!target) { const e = new Error('Image not found'); e.statusCode = 404; throw e; }

  meetup.images.forEach((img) => { img.isMain = img.publicId === publicId; });
  syncBannerFromImages(meetup);

  if (isMeetupLive(meetup) && role !== 'admin') {
    meetup.status = 'submitted';
    meetup.isAdminApproved = false;
  }

  await meetup.save();
  return { meetup };
};

// ─── 11. Participation — Mark Interested ─────────────────────────────────────
const markInterested = async (meetupId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId).lean();
  if (!meetup || !isMeetupLive(meetup)) {
    const e = new Error('Cannot mark interest on an unavailable meetup'); e.statusCode = 400; throw e;
  }

  const existing = await MeetupParticipant.findOne({ meetup: meetupId, user: userId });

  if (existing) {
    if (existing.status === 'interested') {
      await MeetupParticipant.findByIdAndDelete(existing._id);
      await syncParticipantCounts(meetupId);
      return { interested: false };
    }
    const e = new Error('You have already joined this meetup'); e.statusCode = 400; throw e;
  }

  await MeetupParticipant.create({ meetup: meetupId, user: userId, status: 'interested' });
  const counts = await syncParticipantCounts(meetupId);
  return { interested: true, ...counts };
};

// ─── 12. Participation — Join ─────────────────────────────────────────────────
const joinMeetup = async (meetupId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) { const e = new Error('Meetup not found'); e.statusCode = 404; throw e; }
  if (!isMeetupLive(meetup)) { const e = new Error('This meetup is not available for joining'); e.statusCode = 400; throw e; }

  const existing = await MeetupParticipant.findOne({ meetup: meetupId, user: userId });
  if (existing && !['cancelled', 'rejected'].includes(existing.status)) {
    const e = new Error(`You already have a participation record with status: ${existing.status}`);
    e.statusCode = 409;
    throw e;
  }

  const { capacity, registrationType } = meetup.participation;
  const confirmedCount = await MeetupParticipant.countDocuments({
    meetup: meetupId,
    status: { $in: ['approved', 'confirmed', 'attended'] },
  });

  let status;
  let waitlistPosition = null;

  if (registrationType === 'approval') {
    status = 'requested';
  } else if (capacity && confirmedCount >= capacity) {
    const waitlistCount = await MeetupParticipant.countDocuments({ meetup: meetupId, status: 'waitlisted' });
    waitlistPosition = waitlistCount + 1;
    status = 'waitlisted';
  } else {
    status = 'confirmed';
  }

  const participant = await MeetupParticipant.findOneAndUpdate(
    { meetup: meetupId, user: userId },
    { $set: { status, joinedAt: new Date(), waitlistPosition } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const counts = await syncParticipantCounts(meetupId);
  return { participant, ...counts };
};

// ─── 13. Participation — Cancel ───────────────────────────────────────────────
const cancelParticipation = async (meetupId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const participant = await MeetupParticipant.findOne({ meetup: meetupId, user: userId });
  if (!participant) { const e = new Error('No participation record found'); e.statusCode = 404; throw e; }

  const wasConfirmed = ['confirmed', 'approved'].includes(participant.status);

  participant.status = 'cancelled';
  participant.cancelledAt = new Date();
  participant.cancelledBy = 'user';
  await participant.save();

  if (wasConfirmed) {
    await MeetupParticipant.findOneAndUpdate(
      { meetup: meetupId, status: 'waitlisted' },
      { $set: { status: 'confirmed', approvedAt: new Date(), waitlistPosition: null } },
      { sort: { waitlistPosition: 1 }, new: true }
    );
  }

  await syncParticipantCounts(meetupId);
  return { cancelled: true };
};

// ─── 14. Participants List ────────────────────────────────────────────────────
const getMeetupParticipants = async (meetupId, userId, role, query = {}) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId).lean();
  if (!meetup) { const e = new Error('Meetup not found'); e.statusCode = 404; throw e; }
  if (!canManageMeetup(meetup, userId, role)) { const e = new Error('Unauthorized'); e.statusCode = 403; throw e; }

  const { status, page = 1, limit = 50 } = query;
  const filter = { meetup: meetupId };
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [participants, total] = await Promise.all([
    MeetupParticipant.find(filter)
      .populate('user', 'name email phone role')
      .sort({ joinedAt: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    MeetupParticipant.countDocuments(filter),
  ]);

  return { participants, total, page: Number(page), limit: Number(limit) };
};

// ─── 15. My Meetups (Owner) ───────────────────────────────────────────────────
const getMyMeetups = async (userId) => {
  const rawMeetups = await Meetup.find({ createdBy: userId })
    .populate(BASE_POPULATE)
    .sort({ createdAt: -1 })
    .lean();

  const meetups = await batchPopulateCategories(rawMeetups);
  return { meetups };
};

// ─── 16. Legacy RSVP (backward compat) ───────────────────────────────────────
const rsvpMeetup = async (meetupId, userId, rsvpStatus) => {
  if (!['interested', 'going'].includes(rsvpStatus)) {
    const e = new Error('Invalid RSVP status'); e.statusCode = 400; throw e;
  }
  if (rsvpStatus === 'going') return joinMeetup(meetupId, userId);
  return markInterested(meetupId, userId);
};

// ─── 17. Admin: Get All ───────────────────────────────────────────────────────
const adminGetAllMeetups = async (params = {}) => {
  const { status, category, city, page = 1, limit = 20 } = params;
  const query = {};
  if (status) query.status = status;
  if (category) query.category = category;
  if (city) query['location.city'] = { $regex: new RegExp(city, 'i') };

  const parsedPage  = Math.max(1, parseInt(page, 10));
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (parsedPage - 1) * parsedLimit;

  const [rawMeetups, total] = await Promise.all([
    Meetup.find(query)
      .populate('createdBy', 'name email phone role')
      .populate('organizer.pg', 'name city area')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Meetup.countDocuments(query),
  ]);

  const meetups = await batchPopulateCategories(rawMeetups);

  return { meetups, pagination: { page: parsedPage, limit: parsedLimit, total, totalPages: Math.ceil(total / parsedLimit) } };
};

// ─── 18. Admin: KPIs ─────────────────────────────────────────────────────────
const adminGetKPIs = async () => {
  const today = new Date();
  const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(today); todayEnd.setHours(23, 59, 59, 999);

  const [total, active, pending, todayCount, participants, cancelled, featured] =
    await Promise.all([
      Meetup.countDocuments({}),
      Meetup.countDocuments({ status: 'published', isAdminApproved: true }),
      Meetup.countDocuments({ status: { $in: ['submitted', 'under_review'] } }),
      Meetup.countDocuments({ status: 'published', isAdminApproved: true, startDate: { $gte: todayStart, $lte: todayEnd } }),
      MeetupParticipant.countDocuments({ status: { $in: ['confirmed', 'approved', 'attended'] } }),
      Meetup.countDocuments({ status: 'cancelled' }),
      Meetup.countDocuments({ isFeatured: true }),
    ]);

  return { total, active, pending, today: todayCount, participants, cancelled, featured };
};

// ─── 19. Admin: Lifecycle Transition ─────────────────────────────────────────
const adminLifecycleTransition = async (meetupId, newStatus, adminId, reason = null) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) { const e = new Error('Meetup not found'); e.statusCode = 404; throw e; }

  const approvedStatuses = ['published', 'upcoming', 'ongoing', 'completed', 'repeating', 'paused'];
  const isApproving = approvedStatuses.includes(newStatus);

  meetup.status = newStatus;
  meetup.isAdminApproved = isApproving;
  if (reason) meetup.rejectionReason = reason;
  if (newStatus === 'published') meetup.rejectionReason = null;

  await meetup.save();
  return { meetup };
};

// ─── 20. Admin: Feature ───────────────────────────────────────────────────────
const adminToggleFeature = async (meetupId, featured, featuredUntil = null) => {
  if (!mongoose.Types.ObjectId.isValid(meetupId)) {
    const e = new Error('Invalid Meetup ID'); e.statusCode = 400; throw e;
  }
  const meetup = await Meetup.findById(meetupId);
  if (!meetup) { const e = new Error('Meetup not found'); e.statusCode = 404; throw e; }

  meetup.isFeatured = featured;
  meetup.featuredUntil = featuredUntil || null;
  await meetup.save();
  return { meetup };
};

// ─── 21. Admin: Toggle Approval (compat) ─────────────────────────────────────
const adminToggleApproval = async (meetupId, approve) => {
  const newStatus = approve ? 'published' : 'submitted';
  return adminLifecycleTransition(meetupId, newStatus);
};

module.exports = {
  // Public
  getDiscoverySections,
  getMeetups,
  getNearbyMeetups,
  getUpcomingMeetups,
  getMeetupById,
  // Owner
  createMeetup,
  updateMeetup,
  deleteMeetup,
  submitMeetup,
  uploadMeetupImages,
  deleteMeetupImage,
  setMainMeetupImage,
  markInterested,
  joinMeetup,
  cancelParticipation,
  getMeetupParticipants,
  getMyMeetups,
  rsvpMeetup,
  // Admin
  adminGetAllMeetups,
  adminGetKPIs,
  adminLifecycleTransition,
  adminToggleFeature,
  adminToggleApproval,
  // Constants
  MIN_MEETUP_IMAGES,
  MAX_MEETUP_IMAGES,
};

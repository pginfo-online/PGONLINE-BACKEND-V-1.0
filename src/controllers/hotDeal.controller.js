const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const HotDeal = require('../models/HotDeal.model');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

// ─── Helper: sync coverImage from images array ────────────────────────────────
function syncCover(deal) {
  const main = deal.images.find((img) => img.isMain) || deal.images[0];
  if (main) {
    deal.coverImage = { url: main.url, publicId: main.publicId };
  }
}

// ─── Admin: Create Deal ───────────────────────────────────────────────────────
const createDeal = asyncHandler(async (req, res) => {
  const data = { ...req.body, createdBy: req.user._id };

  // Parse JSON arrays if sent as strings (multipart/form-data)
  ['cityIds', 'areaIds', 'cityNames', 'areaNames', 'highlights', 'tags'].forEach((key) => {
    if (typeof data[key] === 'string') {
      try { data[key] = JSON.parse(data[key]); } catch (_) {}
    }
  });

  // Handle image uploads
  if (req.files && req.files.length > 0) {
    const uploads = await Promise.all(
      req.files.map(async (file, i) => {
        const result = await uploadToCloudinary(file.buffer, 'pginfo/hot-deals', 'image');
        return {
          url: result.secure_url,
          publicId: result.public_id,
          isMain: i === 0,
          width: result.width,
          height: result.height,
        };
      })
    );
    data.images = uploads;
  }

  const deal = await HotDeal.create(data);
  await deal.populate('category', 'name displayName icon color');
  return successResponse(res, 'Deal created', { deal }, 201);
});

// ─── Admin: Update Deal ───────────────────────────────────────────────────────
const updateDeal = asyncHandler(async (req, res) => {
  const deal = await HotDeal.findById(req.params.id);
  if (!deal) return errorResponse(res, 'Deal not found', 404);

  const data = { ...req.body };

  // Parse JSON strings
  ['cityIds', 'areaIds', 'cityNames', 'areaNames', 'highlights', 'tags'].forEach((key) => {
    if (typeof data[key] === 'string') {
      try { data[key] = JSON.parse(data[key]); } catch (_) {}
    }
  });

  // Handle new image uploads (appended to existing)
  if (req.files && req.files.length > 0) {
    const uploads = await Promise.all(
      req.files.map(async (file) => {
        const result = await uploadToCloudinary(file.buffer, 'pginfo/hot-deals', 'image');
        return {
          url: result.secure_url,
          publicId: result.public_id,
          isMain: false,
          width: result.width,
          height: result.height,
        };
      })
    );
    // If no existing images, first new one is main
    if (deal.images.length === 0 && uploads.length > 0) uploads[0].isMain = true;
    deal.images.push(...uploads);
  }

  Object.assign(deal, data);
  await deal.save();
  await deal.populate('category', 'name displayName icon color');
  return successResponse(res, 'Deal updated', { deal });
});

// ─── Admin: Delete Deal ───────────────────────────────────────────────────────
const deleteDeal = asyncHandler(async (req, res) => {
  const deal = await HotDeal.findById(req.params.id);
  if (!deal) return errorResponse(res, 'Deal not found', 404);

  // Delete all Cloudinary images
  const publicIds = deal.images.map((img) => img.publicId).filter(Boolean);
  if (publicIds.length > 0) {
    await Promise.allSettled(publicIds.map((id) => deleteFromCloudinary(id, 'image')));
  }
  if (deal.providerLogo?.publicId) {
    await deleteFromCloudinary(deal.providerLogo.publicId, 'image').catch(() => {});
  }

  await deal.deleteOne();
  return successResponse(res, 'Deal deleted');
});

// ─── Admin: Get Single Deal ───────────────────────────────────────────────────
const getDeal = asyncHandler(async (req, res) => {
  const deal = await HotDeal.findById(req.params.id)
    .populate('category', 'name displayName icon color')
    .populate('createdBy', 'name email');
  if (!deal) return errorResponse(res, 'Deal not found', 404);
  return successResponse(res, 'Deal fetched', { deal });
});

// ─── Admin: List All Deals (with search, filter, sort, pagination) ─────────────
const adminListDeals = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.isFeatured !== undefined) filter.isFeatured = req.query.isFeatured === 'true';

  // Text search
  if (req.query.search) {
    const searchRgx = new RegExp(req.query.search, 'i');
    filter.$or = [
      { title: searchRgx },
      { providerName: searchRgx },
      { couponCode: searchRgx },
    ];
  }

  // Sort
  let sort = { createdAt: -1 };
  if (req.query.sort === 'discount') sort = { discountPercent: -1 };
  if (req.query.sort === 'endDate') sort = { endDate: 1 };
  if (req.query.sort === 'startDate') sort = { startDate: 1 };
  if (req.query.sort === 'price') sort = { dealPrice: 1 };

  const [deals, total] = await Promise.all([
    HotDeal.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name displayName icon color')
      .select('-termsAndConditions -howToRedeem -highlights -internalNote'),
    HotDeal.countDocuments(filter),
  ]);

  // Stats for admin dashboard bar
  const [liveCount, scheduledCount, expiredCount, draftCount] = await Promise.all([
    HotDeal.countDocuments({ status: 'live' }),
    HotDeal.countDocuments({ status: 'scheduled' }),
    HotDeal.countDocuments({ status: 'expired' }),
    HotDeal.countDocuments({ status: 'draft' }),
  ]);

  return paginatedResponse(res, 'Deals fetched', deals, {
    page, limit, total, pages: Math.ceil(total / limit),
    stats: { live: liveCount, scheduled: scheduledCount, expired: expiredCount, draft: draftCount },
  });
});

// ─── Admin: Change Deal Status ────────────────────────────────────────────────
const changeDealStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ['draft', 'scheduled', 'live', 'paused', 'expired'];
  if (!allowed.includes(status)) return errorResponse(res, 'Invalid status', 400);

  const deal = await HotDeal.findById(req.params.id);
  if (!deal) return errorResponse(res, 'Deal not found', 404);

  deal.status = status;
  await deal.save();
  return successResponse(res, `Deal status changed to "${status}"`, { deal: { _id: deal._id, status: deal.status } });
});

// ─── Admin: Toggle Featured ───────────────────────────────────────────────────
const toggleFeatured = asyncHandler(async (req, res) => {
  const deal = await HotDeal.findById(req.params.id);
  if (!deal) return errorResponse(res, 'Deal not found', 404);

  deal.isFeatured = !deal.isFeatured;
  if (!deal.isFeatured) deal.featuredUntil = null;
  await deal.save();
  return successResponse(res, `Deal ${deal.isFeatured ? 'featured' : 'unfeatured'}`, {
    deal: { _id: deal._id, isFeatured: deal.isFeatured },
  });
});

// ─── Admin: Upload Deal Images ────────────────────────────────────────────────
const uploadDealImages = asyncHandler(async (req, res) => {
  const deal = await HotDeal.findById(req.params.id);
  if (!deal) return errorResponse(res, 'Deal not found', 404);

  if (!req.files || req.files.length === 0) {
    return errorResponse(res, 'No images uploaded', 400);
  }

  const uploads = await Promise.all(
    req.files.map(async (file) => {
      const result = await uploadToCloudinary(file.buffer, 'pginfo/hot-deals', 'image');
      return {
        url: result.secure_url,
        publicId: result.public_id,
        isMain: false,
        width: result.width,
        height: result.height,
      };
    })
  );

  // If no images existed, first upload is main
  if (deal.images.length === 0 && uploads.length > 0) uploads[0].isMain = true;
  deal.images.push(...uploads);
  syncCover(deal);
  await deal.save();

  return successResponse(res, `${uploads.length} image(s) uploaded`, { images: deal.images });
});

// ─── Admin: Delete Deal Image ─────────────────────────────────────────────────
const deleteDealImage = asyncHandler(async (req, res) => {
  const deal = await HotDeal.findById(req.params.id);
  if (!deal) return errorResponse(res, 'Deal not found', 404);

  const publicId = decodeURIComponent(req.params.publicId);
  const wasMain = deal.images.find((img) => img.publicId === publicId)?.isMain;

  await deleteFromCloudinary(publicId, 'image').catch(() => {});
  deal.images = deal.images.filter((img) => img.publicId !== publicId);

  // If deleted image was main, auto-set next available as main
  if (wasMain && deal.images.length > 0) deal.images[0].isMain = true;
  syncCover(deal);
  await deal.save();

  return successResponse(res, 'Image deleted', { images: deal.images });
});

// ─── Admin: Set Main Image ────────────────────────────────────────────────────
const setMainImage = asyncHandler(async (req, res) => {
  const deal = await HotDeal.findById(req.params.id);
  if (!deal) return errorResponse(res, 'Deal not found', 404);

  const publicId = decodeURIComponent(req.params.publicId);
  deal.images.forEach((img) => { img.isMain = img.publicId === publicId; });
  syncCover(deal);
  await deal.save();

  return successResponse(res, 'Main image updated', { images: deal.images });
});

// ─── Public: Discover Live Deals ─────────────────────────────────────────────
const discoverDeals = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const now = new Date();

  const filter = {
    status: 'live',
    startDate: { $lte: now },
    endDate: { $gte: now },
  };

  if (req.query.category) filter.category = req.query.category;
  if (req.query.featured === 'true') filter.isFeatured = true;

  // City targeting: show deals matching user's city OR deals with no city restriction
  if (req.query.cityId) {
    filter.$or = [
      { cityIds: { $size: 0 } },
      { cityIds: { $in: [req.query.cityId] } },
    ];
  }
  if (req.query.areaId) {
    filter.$or = filter.$or || [];
    filter.$or = [
      { areaIds: { $size: 0 } },
      { areaIds: { $in: [req.query.areaId] } },
    ];
  }

  // Sort
  let sort = { isFeatured: -1, createdAt: -1 };
  if (req.query.sort === 'discount') sort = { discountPercent: -1, createdAt: -1 };
  if (req.query.sort === 'expiry') sort = { endDate: 1 };
  if (req.query.sort === 'price') sort = { dealPrice: 1 };

  const [deals, total] = await Promise.all([
    HotDeal.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name displayName icon color slug')
      .select('-termsAndConditions -howToRedeem -highlights -internalNote -analytics'),
    HotDeal.countDocuments(filter),
  ]);

  return paginatedResponse(res, 'Deals fetched', deals, {
    page, limit, total, pages: Math.ceil(total / limit),
  });
});

// ─── Public: Get Deal Detail ──────────────────────────────────────────────────
const getDealDetail = asyncHandler(async (req, res) => {
  const now = new Date();
  const deal = await HotDeal.findOne({
    _id: req.params.id,
    status: 'live',
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).populate('category', 'name displayName icon color slug');

  if (!deal) return errorResponse(res, 'Deal not found or no longer available', 404);

  // Increment view count (non-blocking)
  HotDeal.findByIdAndUpdate(deal._id, { $inc: { 'analytics.views': 1 } }).catch(() => {});

  return successResponse(res, 'Deal fetched', { deal });
});

// ─── Public: Claim Deal ───────────────────────────────────────────────────────
const claimDeal = asyncHandler(async (req, res) => {
  const now = new Date();
  const deal = await HotDeal.findOne({
    _id: req.params.id,
    status: 'live',
    startDate: { $lte: now },
    endDate: { $gte: now },
  });

  if (!deal) return errorResponse(res, 'Deal not found or expired', 404);

  // Check availability for limited deals
  if (deal.availabilityType === 'limited') {
    if (deal.claimedCount >= deal.totalQuantity) {
      return errorResponse(res, 'This deal is fully claimed', 410);
    }
    deal.claimedCount += 1;
    deal.analytics.claims += 1;
    // Auto-expire if fully claimed
    if (deal.claimedCount >= deal.totalQuantity) {
      deal.status = 'expired';
    }
    await deal.save();
  } else {
    // Unlimited: just increment analytics (non-blocking)
    HotDeal.findByIdAndUpdate(deal._id, { $inc: { 'analytics.claims': 1 } }).catch(() => {});
  }

  return successResponse(res, 'Deal claimed!', {
    couponCode: deal.couponCode,
    couponType: deal.couponType,
    dealUrl: deal.dealUrl,
    remainingQuantity: deal.remainingQuantity,
  });
});

module.exports = {
  createDeal,
  updateDeal,
  deleteDeal,
  getDeal,
  adminListDeals,
  changeDealStatus,
  toggleFeatured,
  uploadDealImages,
  deleteDealImage,
  setMainImage,
  discoverDeals,
  getDealDetail,
  claimDeal,
};

const mongoose = require('mongoose');

/**
 * Meetup Model — Production-grade community meetup/circle schema.
 *
 * Key design decisions:
 *  - Categories are ObjectId refs to MeetupCategory (no hardcoded enums)
 *  - Full 12-state lifecycle machine (not simple boolean isActive)
 *  - GeoJSON coordinates stored for geospatial queries (2dsphere index)
 *  - Images stored via Cloudinary (url + publicId) — bannerImage auto-synced
 *  - Embedded rsvpList kept as legacyRsvpList for backward compat (deprecated)
 *  - New participation via MeetupParticipant model (separate collection)
 *  - Analytics counts are denormalized for O(1) reads (no aggregate needed)
 *  - Future-proof: ticketing, recurrence, occurrences, highlights, rules
 */

// ─── Lifecycle States ─────────────────────────────────────────────────────────
const MEETUP_STATUSES = [
  'draft',         // Creator is still filling in details
  'submitted',     // Submitted for admin review
  'under_review',  // Admin is reviewing
  'approved',      // Admin approved but not yet published (owner can publish)
  'published',     // Live and visible to all
  'upcoming',      // Computed: published + startDate in future (virtual)
  'ongoing',       // Event is happening right now
  'completed',     // Event has ended
  'repeating',     // Recurring event with active future occurrences
  'paused',        // Creator paused future occurrences
  'cancelled',     // Event cancelled
  'archived',      // No longer shown in discovery, kept for records
];

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

/**
 * Image sub-schema — Cloudinary backed.
 * url:      Cloudinary secure_url
 * publicId: Cloudinary public_id (required for deletion)
 * isMain:   designates the primary cover/banner photo
 */
const imageSchema = new mongoose.Schema(
  {
    url:      { type: String, required: true },
    publicId: { type: String, required: true },
    isMain:   { type: Boolean, default: false },
    width:    { type: Number, default: null },
    height:   { type: Number, default: null },
  },
  { _id: false }
);

/**
 * Legacy RSVP sub-schema — kept for backward compatibility only.
 * New participation is tracked in the MeetupParticipant collection.
 * Do NOT add new RSVPs to this array.
 * @deprecated — use MeetupParticipant model for all new participation
 */
const legacyRsvpSchema = new mongoose.Schema(
  {
    user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status:    { type: String, enum: ['interested', 'going'], required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const meetupSchema = new mongoose.Schema(
  {
    // ─── Identity ───────────────────────────────────────────────────────────
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    shortDescription: {
      type: String,
      trim: true,
      maxlength: [300, 'Short description cannot exceed 300 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },

    // ─── Categories ─────────────────────────────────────────────────────────
    /**
     * category + subcategory are ObjectId refs to MeetupCategory.
     * The frontend loads the category tree from the API — nothing hardcoded.
     */
    category: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'MeetupCategory',
      default: null,
      index: true,
    },
    subcategory: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'MeetupCategory',
      default: null,
    },
    /**
     * legacyCategory — preserves old string category for existing data.
     * Read-only after migration. New meetups must use `category` ObjectId.
     * @deprecated
     */
    legacyCategory: {
      type: String,
      default: null,
    },

    // ─── Cloudinary Images ──────────────────────────────────────────────────
    /**
     * images[] — ordered list of event photos. First isMain:true is the cover.
     * Folder: 'pginfo/meetup-photos'
     * All uploads go through upload.middleware.js → upload.service.js → Cloudinary
     */
    images: [imageSchema],

    /**
     * bannerImage — auto-synced from the main image in images[].
     * Used as a quick cover reference (avoids array scan on every card render).
     * Folder: same as images — 'pginfo/meetup-photos'
     * IMPORTANT: Always call syncBannerFromImages() after any images[] mutation.
     */
    bannerImage: {
      url:      { type: String, default: null },
      publicId: { type: String, default: null },
    },

    // ─── Location ────────────────────────────────────────────────────────────
    /**
     * locationType controls what location fields are relevant.
     * physical: full address + coordinates
     * online:   onlineLink only
     * hybrid:   both physical + onlineLink
     */
    locationType: {
      type: String,
      enum: ['physical', 'online', 'hybrid'],
      default: 'physical',
    },
    location: {
      name:             { type: String, trim: true },
      address:          { type: String, trim: true },
      city:             { type: String, trim: true },
      area:             { type: String, trim: true },
      cityId:           { type: mongoose.Schema.Types.ObjectId, ref: 'City', default: null },
      mapsLink:         { type: String, trim: true },
      placeId:          { type: String, trim: true }, // Google Places ID
      /**
       * coordinates — GeoJSON Point for geospatial queries.
       * Required for "Happening Near You" and nearby discovery.
       * { type: 'Point', coordinates: [longitude, latitude] }
       */
      coordinates: {
        type: {
          type: String,
          enum: ['Point'],
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
        },
      },
    },
    /**
     * onlineLink — Zoom/Meet/Teams link for online/hybrid meetups.
     * Shown to confirmed participants only (not publicly exposed).
     */
    onlineLink: { type: String, trim: true, default: null },

    // ─── Schedule ────────────────────────────────────────────────────────────
    scheduleType: {
      type: String,
      enum: ['one_time', 'recurring', 'tba'],
      default: 'one_time',
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: { type: Date, default: null },
    startTime: { type: String, trim: true }, // e.g. '7:00 PM'
    endTime:   { type: String, trim: true },

    /**
     * recurrence — only relevant when scheduleType === 'recurring'.
     * occurrences are future-scoped (Phase 2).
     */
    recurrence: {
      frequency:  { type: String, enum: ['daily', 'weekly', 'monthly', 'custom'], default: null },
      interval:   { type: Number, default: 1 },   // every N days/weeks/months
      daysOfWeek: { type: [Number], default: [] }, // 0=Sun … 6=Sat
      endDate:    { type: Date, default: null },
      occurrenceCount: { type: Number, default: null }, // max occurrences
    },

    // ─── Ownership ───────────────────────────────────────────────────────────
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    organizer: {
      name:    { type: String, trim: true },
      contact: { type: String, trim: true },
      pg:      { type: mongoose.Schema.Types.ObjectId, ref: 'PG', default: null },
    },

    // ─── Participation Settings ───────────────────────────────────────────────
    participation: {
      /**
       * capacity: null = unlimited
       * capacity: N = max N confirmed participants
       */
      capacity: { type: Number, default: null, min: 1 },
      /**
       * registrationType:
       *   open     — anyone can join immediately (status: confirmed)
       *   approval — organizer must approve each request (status: requested → approved)
       *   invite   — organizer sends invites only
       */
      registrationType: {
        type: String,
        enum: ['open', 'approval', 'invite'],
        default: 'open',
      },
      isFree:               { type: Boolean, default: true },
      registrationDeadline: { type: Date, default: null },
    },

    // ─── Future: Pricing / Ticketing ─────────────────────────────────────────
    // Data model is ready; UI/logic is Phase 2.
    pricing: {
      ticketPrice:     { type: Number, default: 0 },
      earlyBirdPrice:  { type: Number, default: null },
      earlyBirdUntil:  { type: Date, default: null },
      currency:        { type: String, default: 'INR' },
      refundPolicy:    { type: String, trim: true, default: null },
      ticketTypes: [
        {
          name:  { type: String, trim: true },
          price: { type: Number },
          qty:   { type: Number },
          _id: false,
        },
      ],
    },

    // ─── Audience Controls ────────────────────────────────────────────────────
    audience: {
      type: {
        type: String,
        enum: ['everyone', 'students', 'professionals', 'entrepreneurs', 'developers', 'creators', 'sports', 'custom'],
        default: 'everyone',
      },
      customLabel: { type: String, trim: true, default: null }, // if type = 'custom'
      skillLevel: {
        type: String,
        enum: ['all', 'beginner', 'intermediate', 'advanced'],
        default: 'all',
      },
      minAge: { type: Number, default: null },
      maxAge: { type: Number, default: null },
    },

    // ─── Rich Content ─────────────────────────────────────────────────────────
    highlights: [{ type: String, trim: true }], // "What you'll experience"
    rules:       { type: String, trim: true, default: null },
    tags: [{ type: String, trim: true }],
    externalRegistrationLink: { type: String, trim: true, default: null },

    // ─── Lifecycle ───────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: MEETUP_STATUSES,
      default: 'draft',
      index: true,
    },
    isAdminApproved: { type: Boolean, default: false },
    isFeatured:      { type: Boolean, default: false },
    featuredUntil:   { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },

    // ─── Analytics (Denormalized) ─────────────────────────────────────────────
    // Kept in sync by service layer on every join/interest/view action.
    // Read-heavy: O(1) instead of O(n) aggregate per card render.
    analytics: {
      views:           { type: Number, default: 0 },
      shares:          { type: Number, default: 0 },
      interestedCount: { type: Number, default: 0 }, // synced from MeetupParticipant
      goingCount:      { type: Number, default: 0 }, // synced from MeetupParticipant
    },

    // ─── Deprecated / Backward Compat ────────────────────────────────────────
    /**
     * legacyRsvpList — the old embedded RSVP array.
     * Kept so existing data is not lost. Read-only after migration.
     * New participation uses the MeetupParticipant collection.
     * @deprecated
     */
    legacyRsvpList: [legacyRsvpSchema],
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────────
// interestedCount / goingCount — read from denormalized analytics field now.
// Kept as virtuals for old client compatibility (falls back to legacyRsvpList).
meetupSchema.virtual('interestedCount').get(function () {
  if (this.analytics?.interestedCount != null) return this.analytics.interestedCount;
  return (this.legacyRsvpList || []).filter((r) => r.status === 'interested').length;
});
meetupSchema.virtual('goingCount').get(function () {
  if (this.analytics?.goingCount != null) return this.analytics.goingCount;
  return (this.legacyRsvpList || []).filter((r) => r.status === 'going').length;
});
// rsvpList virtual — backward compat alias for old frontend code reading meetup.rsvpList
meetupSchema.virtual('rsvpList').get(function () {
  return this.legacyRsvpList || [];
});

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Discovery: published live meetups sorted by date
meetupSchema.index({ status: 1, isAdminApproved: 1, startDate: 1 });

// Discovery: category-filtered live meetups
meetupSchema.index({ status: 1, isAdminApproved: 1, category: 1, startDate: 1 });

// Discovery: city-scoped search
meetupSchema.index({ status: 1, isAdminApproved: 1, 'location.city': 1, startDate: 1 });

// Discovery: today's meetups
meetupSchema.index({ status: 1, isAdminApproved: 1, startDate: 1, 'location.city': 1 });

// Discovery: popular meetups (by going count)
meetupSchema.index({ status: 1, isAdminApproved: 1, 'analytics.goingCount': -1 });

// Discovery: newest meetups
meetupSchema.index({ status: 1, isAdminApproved: 1, createdAt: -1 });

// Discovery: free meetups
meetupSchema.index({ status: 1, isAdminApproved: 1, 'participation.isFree': 1, startDate: 1 });

// Discovery: online meetups
meetupSchema.index({ status: 1, isAdminApproved: 1, locationType: 1, startDate: 1 });

// Discovery: featured meetups
meetupSchema.index({ isFeatured: 1, status: 1, isAdminApproved: 1, startDate: 1 });

// Owner's meetups
meetupSchema.index({ createdBy: 1, createdAt: -1 });

// Admin management
meetupSchema.index({ status: 1, createdAt: -1 });

// Clean up GeoJSON coordinates before saving to avoid MongoDB 2dsphere "Can't extract geo keys" error
meetupSchema.pre('save', function (next) {
  if (this.location && this.location.coordinates) {
    const coords = this.location.coordinates.coordinates;
    if (
      !Array.isArray(coords) ||
      coords.length !== 2 ||
      typeof coords[0] !== 'number' ||
      typeof coords[1] !== 'number' ||
      isNaN(coords[0]) ||
      isNaN(coords[1])
    ) {
      this.location.coordinates = undefined;
    } else {
      this.location.coordinates.type = 'Point';
    }
  }
  next();
});

module.exports = mongoose.model('Meetup', meetupSchema);

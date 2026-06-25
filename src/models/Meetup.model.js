const mongoose = require('mongoose');

const rsvpSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['interested', 'going'], required: true },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const meetupSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000 },
    category: {
      type: String,
      enum: ['career', 'business', 'community', 'educational', 'health', 'social', 'other'],
      default: 'community',
    },
    bannerImage: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },
    images: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
        isMain: { type: Boolean, default: false },
      },
    ],
    location: {
      name: { type: String, trim: true },
      address: { type: String, trim: true },
      mapsLink: { type: String, trim: true },
      city: { type: String, trim: true },
    },
    startDate: { type: Date, required: [true, 'Start date is required'] },
    endDate: { type: Date, default: null },
    startTime: { type: String, trim: true }, // e.g. '10:00 AM'
    endTime: { type: String, trim: true },
    organizer: {
      name: { type: String, trim: true },
      contact: { type: String, trim: true },
      pg: { type: mongoose.Schema.Types.ObjectId, ref: 'PG', default: null },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    maxAttendees: { type: Number, default: null, min: 1 },
    registrationDeadline: { type: Date, default: null },
    externalRegistrationLink: { type: String, trim: true, default: null },
    tags: [{ type: String, trim: true }],
    status: {
      type: String,
      enum: ['draft', 'pending_approval', 'published', 'cancelled', 'completed'],
      default: 'draft',
    },
    isAdminApproved: { type: Boolean, default: false },
    rsvpList: [rsvpSchema],
    analytics: {
      views: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: interested count
meetupSchema.virtual('interestedCount').get(function () {
  return this.rsvpList.filter(r => r.status === 'interested').length;
});

// Virtual: going count
meetupSchema.virtual('goingCount').get(function () {
  return this.rsvpList.filter(r => r.status === 'going').length;
});

meetupSchema.index({ status: 1, startDate: 1 });
meetupSchema.index({ status: 1, isAdminApproved: 1, startDate: 1 });
meetupSchema.index({ category: 1 });
meetupSchema.index({ createdBy: 1 });
meetupSchema.index({ 'location.city': 1 });

module.exports = mongoose.model('Meetup', meetupSchema);

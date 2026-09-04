'use strict';

/**
 * memberships.js
 *
 * Async helper that builds a lightweight membership summary for a user.
 * Used in GET /auth/me to inform the mobile app how many businesses
 * the user owns — without sending full lists.
 *
 * This uses countDocuments() only — no full document fetch.
 * The full PG/Hotel lists are fetched lazily by their respective screens.
 */

const mongoose = require('mongoose');

/**
 * Build membership summary for a user.
 *
 * Returns booleans + counts so the mobile app can decide:
 *  - Whether to offer 'pg_owner' mode
 *  - Whether to show "empty state" vs "dashboard" in owner screens
 *  - Whether to offer 'hotel_owner' mode
 *
 * @param {string|ObjectId} userId  - The user's _id
 * @param {string[]} userRoles      - The user's normalized roles[]
 * @returns {Promise<MembershipSummary>}
 *
 * @typedef {Object} MembershipSummary
 * @property {boolean} pgOwner      - User has PG owner role
 * @property {boolean} hotelOwner   - User has hotel owner role
 * @property {number}  pgCount      - Number of PGs this user owns (active)
 * @property {number}  hotelCount   - Number of hotels this user owns (active)
 * @property {boolean} hasPGs       - Shorthand: pgCount > 0
 * @property {boolean} hasHotels    - Shorthand: hotelCount > 0
 */
const getMembershipSummary = async (userId, userRoles = []) => {
  const isPgOwner = userRoles.includes('owner') || userRoles.includes('pg_owner');
  const isHotelOwner = userRoles.includes('hotel_owner');
  const isAdmin = userRoles.includes('admin');

  let pgCount = 0;
  let hotelCount = 0;

  // Only query if user actually has the relevant role (or is admin)
  const countsToFetch = [];

  if (isPgOwner || isAdmin) {
    countsToFetch.push(
      (async () => {
        try {
          const PG = require('../models/PG.model');
          pgCount = await PG.countDocuments({ owner: userId });
        } catch (_) {
          // Non-critical — if PG model fails, default to 0
          pgCount = 0;
        }
      })()
    );
  }

  if (isHotelOwner || isAdmin) {
    countsToFetch.push(
      (async () => {
        try {
          const Hotel = require('../models/Hotel.model');
          hotelCount = await Hotel.countDocuments({ owner: userId });
        } catch (_) {
          // Non-critical — default to 0
          hotelCount = 0;
        }
      })()
    );
  }

  // Run in parallel
  if (countsToFetch.length > 0) {
    await Promise.all(countsToFetch);
  }

  return {
    pgOwner: isPgOwner || isAdmin,
    hotelOwner: isHotelOwner || isAdmin,
    pgCount,
    hotelCount,
    hasPGs: pgCount > 0,
    hasHotels: hotelCount > 0,
  };
};

module.exports = { getMembershipSummary };

'use strict';

/**
 * capabilities.js
 *
 * Server-side RBAC capability derivation.
 *
 * Capabilities are derived purely from a user's roles[] array.
 * They are a higher-level, intent-based layer on top of roles that
 * the mobile app and frontend use to make UI decisions.
 *
 * No DB calls — pure function, deterministic, fast, easily testable.
 *
 * Capability → Role mapping:
 *   can_manage_pgs       → owner | pg_owner | admin
 *   can_manage_hotels    → hotel_owner | admin
 *   can_manage_buffets   → hotel_owner | admin
 *   can_manage_meetups   → meetup_organizer | admin
 *   can_manage_hot_deals → hot_deals_partner | admin
 *   can_manage_staff     → owner | pg_owner | admin
 *   is_admin             → admin
 *   is_pg_owner          → owner | pg_owner
 *   is_hotel_owner       → hotel_owner
 *   can_access_analytics → admin | owner | pg_owner | hotel_owner
 */

const CAPABILITY_ROLE_MAP = {
  can_manage_pgs: ['owner', 'pg_owner', 'admin'],
  can_manage_hotels: ['hotel_owner', 'admin'],
  can_manage_buffets: ['hotel_owner', 'admin'],
  can_manage_meetups: ['meetup_organizer', 'admin'],
  can_manage_hot_deals: ['hot_deals_partner', 'admin'],
  can_manage_staff: ['owner', 'pg_owner', 'property_manager', 'admin'],
  is_admin: ['admin'],
  is_pg_owner: ['owner', 'pg_owner'],
  is_hotel_owner: ['hotel_owner'],
  can_access_analytics: ['admin', 'owner', 'pg_owner', 'hotel_owner'],
};

/**
 * Derive the list of capabilities for a user based on their roles[].
 *
 * @param {object} user  - A Mongoose user document or plain object with roles[]
 * @returns {string[]}   - Array of capability strings
 */
const deriveCapabilities = (user) => {
  if (!user) return [];

  const userRoles = Array.isArray(user.roles) && user.roles.length > 0
    ? user.roles
    : user.role
      ? [user.role]
      : ['tenant'];

  const capabilities = [];

  for (const [capability, allowedRoles] of Object.entries(CAPABILITY_ROLE_MAP)) {
    if (allowedRoles.some((r) => userRoles.includes(r))) {
      capabilities.push(capability);
    }
  }

  return capabilities;
};

/**
 * Derive the available mobile/web experience modes for a user.
 *
 * Modes map to distinct navigation trees in the mobile app.
 * 'explore' is always available to all authenticated users.
 *
 * @param {object} user  - A Mongoose user document or plain object
 * @returns {string[]}   - Ordered array of mode identifiers
 */
const deriveAvailableModes = (user) => {
  if (!user) return ['explore'];

  const caps = deriveCapabilities(user);
  const modes = ['explore']; // always available

  if (caps.includes('can_manage_pgs')) {
    modes.push('pg_owner');
  }

  if (caps.includes('can_manage_hotels')) {
    modes.push('hotel_owner');
  }

  return modes;
};

/**
 * Check if a user has a specific capability.
 *
 * @param {object} user        - User document
 * @param {string} capability  - Capability string e.g. 'can_manage_pgs'
 * @returns {boolean}
 */
const hasCapability = (user, capability) => {
  return deriveCapabilities(user).includes(capability);
};

module.exports = {
  deriveCapabilities,
  deriveAvailableModes,
  hasCapability,
  CAPABILITY_ROLE_MAP,
};

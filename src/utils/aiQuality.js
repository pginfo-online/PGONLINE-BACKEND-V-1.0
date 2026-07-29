const MANDATORY_FIELDS = ['name', 'city', 'area', 'address', 'contactPhone'];

const getMissingFields = (data) => {
  const missing = MANDATORY_FIELDS.filter(f => !data[f]);
  const hasRent = data.rent?.single || data.rent?.double || data.rent?.triple;
  if (!hasRent) missing.push('rent (at least one sharing type)');
  return missing;
};

const detectContradictions = (data) => {
  const issues = [];
  if (data.food === 'none' && data.foodIncluded === true) {
    issues.push('Food is set to "none" but food is included in rent');
  }
  if (data.availableRooms !== undefined && data.totalBeds !== undefined && data.availableRooms > data.totalBeds) {
    issues.push('Available rooms cannot exceed total beds');
  }
  return issues;
};

module.exports = { getMissingFields, detectContradictions };
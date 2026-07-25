const axios = require('axios');

/**
 * Geocode an address using the free Nominatim (OpenStreetMap) API.
 * Nominatim has usage limits (max 1 request per second). This function
 * gracefully handles errors and returns null coordinates if it fails.
 * 
 * @param {string} address - The address to geocode
 * @returns {Promise<{latitude: number, longitude: number} | null>}
 */
const geocodeAddress = async (address) => {
  if (!address || !address.trim()) return null;

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: address,
        format: 'json',
        limit: 1,
      },
      headers: {
        // Nominatim requires a User-Agent header to identify the app
        'User-Agent': 'PGInfoOnline/1.0 (contact@pginfo.online)' 
      },
      timeout: 5000 // 5 seconds timeout
    });

    if (response.data && response.data.length > 0) {
      return {
        latitude: parseFloat(response.data[0].lat),
        longitude: parseFloat(response.data[0].lon)
      };
    }
    
    return null;
  } catch (error) {
    console.error('Geocoding error:', error.message);
    return null;
  }
};

module.exports = { geocodeAddress };

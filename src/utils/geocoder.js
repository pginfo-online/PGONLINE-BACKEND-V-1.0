const axios = require('axios');

/**
 * Geocode an address using Google Geocoding API or Nominatim fallback.
 * 
 * @param {string} address - The address to geocode
 * @returns {Promise<{latitude: number, longitude: number, placeId?: string, fullAddress?: string, postalCode?: string, country?: string, state?: string, district?: string, city?: string} | null>}
 */
const geocodeAddress = async (address) => {
  if (!address || !address.trim()) return null;

  try {
    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (googleApiKey) {
      // Use Google Geocoding API
      const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: {
          address: address,
          key: googleApiKey,
        },
        timeout: 5000
      });

      if (response.data && response.data.results && response.data.results.length > 0) {
        const result = response.data.results[0];
        const { lat, lng } = result.geometry.location;
        const placeId = result.place_id;
        
        // Extract address components
        const addressComponents = {
          fullAddress: result.formatted_address,
          postalCode: '',
          country: '',
          state: '',
          district: '',
          city: '',
        };
        
        result.address_components.forEach(comp => {
          if (comp.types.includes('postal_code')) addressComponents.postalCode = comp.long_name;
          if (comp.types.includes('country')) addressComponents.country = comp.long_name;
          if (comp.types.includes('administrative_area_level_1')) addressComponents.state = comp.long_name;
          if (comp.types.includes('administrative_area_level_3')) addressComponents.district = comp.long_name;
          if (comp.types.includes('locality')) addressComponents.city = comp.long_name;
        });

        return {
          latitude: lat,
          longitude: lng,
          placeId,
          ...addressComponents
        };
      }
    } else {
      // Fallback to Nominatim
      const response = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: {
          q: address,
          format: 'json',
          limit: 1,
        },
        headers: {
          'User-Agent': 'PGInfoOnline/1.0 (contact@pginfo.online)' 
        },
        timeout: 5000
      });

      if (response.data && response.data.length > 0) {
        return {
          latitude: parseFloat(response.data[0].lat),
          longitude: parseFloat(response.data[0].lon)
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Geocoding error:', error.message);
    return null;
  }
};

/**
 * Reverse geocode coordinates using Google Geocoding API or Nominatim fallback.
 * 
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<object | null>}
 */
const reverseGeocode = async (lat, lng) => {
  if (!lat || !lng) return null;
  try {
    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (googleApiKey) {
      const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { latlng: `${lat},${lng}`, key: googleApiKey },
        timeout: 5000
      });
      if (response.data && response.data.results && response.data.results.length > 0) {
        const result = response.data.results[0];
        const placeId = result.place_id;
        const addressComponents = {
          fullAddress: result.formatted_address,
          postalCode: '', country: '', state: '', district: '', city: '',
        };
        result.address_components.forEach(comp => {
          if (comp.types.includes('postal_code')) addressComponents.postalCode = comp.long_name;
          if (comp.types.includes('country')) addressComponents.country = comp.long_name;
          if (comp.types.includes('administrative_area_level_1')) addressComponents.state = comp.long_name;
          if (comp.types.includes('administrative_area_level_3')) addressComponents.district = comp.long_name;
          if (comp.types.includes('locality')) addressComponents.city = comp.long_name;
        });
        return { placeId, ...addressComponents };
      }
    } else {
      const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: { lat: lat, lon: lng, format: 'json' },
        headers: { 'User-Agent': 'PGInfoOnline/1.0 (contact@pginfo.online)' },
        timeout: 5000
      });
      if (response.data) {
        return { fullAddress: response.data.display_name };
      }
    }
    return null;
  } catch (error) {
    console.error('Reverse Geocoding error:', error.message);
    return null;
  }
};

module.exports = { geocodeAddress, reverseGeocode };

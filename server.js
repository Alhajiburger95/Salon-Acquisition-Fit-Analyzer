const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

function extractNameFromMapsUrl(url) {
  try {
    // /maps/place/Salon+Name/@lat,lng or /maps/place/Salon%20Name/...
    const m = url.match(/\/maps\/place\/([^/@?&]+)/);
    if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '));
    const q = url.match(/[?&]q=([^&]+)/);
    if (q) return decodeURIComponent(q[1].replace(/\+/g, ' '));
  } catch (_) {}
  return null;
}

async function placeDetails(placeId, apiKey) {
  const r = await axios.get(`${PLACES_BASE}/details/json`, {
    params: {
      place_id: placeId,
      fields: [
        'name', 'rating', 'user_ratings_total', 'price_level',
        'opening_hours', 'photos', 'formatted_address', 'website',
        'url', 'reviews', 'geometry', 'types', 'business_status',
        'formatted_phone_number'
      ].join(','),
      key: apiKey,
      language: 'en'
    }
  });
  if (r.data.status !== 'OK') throw new Error(`Places API: ${r.data.status} – ${r.data.error_message || ''}`);
  return r.data.result;
}

async function nearbySearch(lat, lng, apiKey) {
  const r = await axios.get(`${PLACES_BASE}/nearbysearch/json`, {
    params: { location: `${lat},${lng}`, radius: 400, key: apiKey }
  });
  return r.data.results || [];
}

app.post('/api/analyze', async (req, res) => {
  const { input, apiKey, manual } = req.body;

  if (!apiKey?.trim()) return res.status(400).json({ error: 'Google Places API key is required.' });
  if (!input?.trim()) return res.status(400).json({ error: 'Please enter a salon name or Google Maps link.' });

  try {
    let placeId = null;

    // Direct place_id in URL
    const pidMatch = input.match(/place_id[=:]([A-Za-z0-9_-]+)/);
    if (pidMatch) placeId = pidMatch[1];

    // ChIJ... place ID typed directly
    if (!placeId && /^ChIJ/.test(input.trim())) placeId = input.trim();

    let searchQuery = input;
    if (!placeId && (input.includes('maps.google') || input.includes('google.com/maps') || input.includes('goo.gl'))) {
      const name = extractNameFromMapsUrl(input);
      if (name) searchQuery = name;
    }

    if (!placeId) {
      const query = /barcelona/i.test(searchQuery) ? searchQuery : `${searchQuery} hair salon Barcelona Spain`;
      const sr = await axios.get(`${PLACES_BASE}/textsearch/json`, {
        params: { query, key: apiKey, language: 'en', region: 'es' }
      });
      if (sr.data.status !== 'OK' || !sr.data.results?.length) {
        return res.status(404).json({ error: 'No salon found. Try a more specific name or paste the Google Maps link.' });
      }
      placeId = sr.data.results[0].place_id;
    }

    const place = await placeDetails(placeId, apiKey);
    const nearby = await nearbySearch(
      place.geometry.location.lat,
      place.geometry.location.lng,
      apiKey
    );

    res.json({ place, nearby, manual });
  } catch (err) {
    const msg = err.response?.data?.error_message || err.message;
    res.status(500).json({ error: msg });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Salon Analyzer → http://localhost:${PORT}`));

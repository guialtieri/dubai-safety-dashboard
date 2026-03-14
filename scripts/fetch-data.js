#!/usr/bin/env node
/**
 * Daily Data Refresh Script
 * Runs via GitHub Actions at 08:00 GST (04:00 UTC) every day.
 *
 * Fetches:
 *   1. Flight prices from DXB & AUH to all destinations (Booking.com API via RapidAPI)
 *   2. Hotel availability in relocation cities (Booking.com API via RapidAPI)
 *
 * Conflict/kinetic data and infrastructure statuses remain manually curated
 * (no reliable API exists for these).
 *
 * Writes updated data to: data/dashboard-state.json
 */

const fs = require('fs');
const path = require('path');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = 'booking-com15.p.rapidapi.com';

if (!RAPIDAPI_KEY) {
  console.error('ERROR: RAPIDAPI_KEY environment variable is not set.');
  process.exit(1);
}

// ── Config ──────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, '..', 'data', 'dashboard-state.json');

// Airports we search from
const ORIGIN_AIRPORTS = {
  DXB: { name: 'Dubai Intl', iata: 'DXB' },
  AUH: { name: 'Abu Dhabi Intl', iata: 'AUH' }
};

// Flight destinations
const FLIGHT_DESTINATIONS = [
  { city: 'Muscat', code: 'MCT', country: 'Oman' },
  { city: 'Frankfurt', code: 'FRA', country: 'Germany' },
  { city: 'Amsterdam', code: 'AMS', country: 'Netherlands' },
  { city: 'Paris', code: 'CDG', country: 'France' },
  { city: 'Rome', code: 'FCO', country: 'Italy' },
  { city: 'London', code: 'LHR', country: 'United Kingdom' },
  { city: 'Lisbon', code: 'LIS', country: 'Portugal' },
  { city: 'Rio de Janeiro', code: 'GIG', country: 'Brazil' },
  { city: 'São Paulo', code: 'GRU', country: 'Brazil' },
  { city: 'Istanbul', code: 'IST', country: 'Turkey' },
  { city: 'Mumbai', code: 'BOM', country: 'India' },
  { city: 'Cairo', code: 'CAI', country: 'Egypt' },
  { city: 'Nairobi', code: 'NBO', country: 'Kenya' }
];

// Hotel / relocation destinations (searched by coordinates)
const RELOCATION_DESTINATIONS = [
  { destination: 'Al Ain', emirate: 'Abu Dhabi', lat: 24.2075, lng: 55.7447 },
  { destination: 'Hatta', emirate: 'Dubai', lat: 24.7953, lng: 56.1097 },
  { destination: 'Dibba (Fujairah)', emirate: 'Fujairah', lat: 25.6189, lng: 56.2631 },
  { destination: 'Ras Al Khaimah City', emirate: 'RAK', lat: 25.7895, lng: 55.9432 },
  { destination: 'Ajman City', emirate: 'Ajman', lat: 25.4052, lng: 55.5136 },
  { destination: 'Fujairah City', emirate: 'Fujairah', lat: 25.1288, lng: 56.3264 },
  { destination: 'Khor Fakkan', emirate: 'Sharjah', lat: 25.3459, lng: 56.3512 }
];

// ── API Helpers ─────────────────────────────────────────

async function rapidApiGet(endpoint, params = {}) {
  const url = new URL(`https://${RAPIDAPI_HOST}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': RAPIDAPI_HOST,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    console.warn(`API ${endpoint} returned ${res.status}: ${res.statusText}`);
    return null;
  }
  return res.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Flight Fetching ─────────────────────────────────────

async function fetchFlights() {
  const today = new Date();
  const departDate = today.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`\n✈️  Fetching flights for ${departDate}...`);

  const flights = [];

  for (const dest of FLIGHT_DESTINATIONS) {
    console.log(`  → ${dest.city} (${dest.code})`);

    let dxbPrice = null, auhPrice = null;
    let dxbDepart = null, auhDepart = null;
    let airline = 'Various';

    // DXB → dest
    try {
      const dxbData = await rapidApiGet('/api/v1/flights/searchFlights', {
        fromId: 'DXB.AIRPORT',
        toId: `${dest.code}.AIRPORT`,
        departDate,
        adults: 1,
        cabinClass: 'ECONOMY',
        currency_code: 'AED',
        sort: 'CHEAPEST'
      });

      if (dxbData?.data?.flightOffers?.[0]) {
        const offer = dxbData.data.flightOffers[0];
        dxbPrice = Math.round(offer.priceBreakdown?.total?.units || 0);
        dxbDepart = offer.segments?.[0]?.departureTime || `${departDate}T12:00+04:00`;
        airline = offer.segments?.[0]?.legs?.[0]?.carriersData?.[0]?.name || 'Various';
      }
    } catch (e) {
      console.warn(`    DXB→${dest.code} error:`, e.message);
    }

    await sleep(300); // Rate limiting

    // AUH → dest
    try {
      const auhData = await rapidApiGet('/api/v1/flights/searchFlights', {
        fromId: 'AUH.AIRPORT',
        toId: `${dest.code}.AIRPORT`,
        departDate,
        adults: 1,
        cabinClass: 'ECONOMY',
        currency_code: 'AED',
        sort: 'CHEAPEST'
      });

      if (auhData?.data?.flightOffers?.[0]) {
        const offer = auhData.data.flightOffers[0];
        auhPrice = Math.round(offer.priceBreakdown?.total?.units || 0);
        auhDepart = offer.segments?.[0]?.departureTime || `${departDate}T14:00+04:00`;
      }
    } catch (e) {
      console.warn(`    AUH→${dest.code} error:`, e.message);
    }

    await sleep(300); // Rate limiting

    flights.push({
      city: dest.city,
      code: dest.code,
      country: dest.country,
      dxbPriceAED: dxbPrice || 0,
      auhPriceAED: auhPrice || 0,
      dxbDeltaAED: 0, // Will be computed by comparing with yesterday's data
      auhDeltaAED: 0,
      dxbDepart: dxbDepart || `${departDate}T12:00+04:00`,
      auhDepart: auhDepart || `${departDate}T14:00+04:00`,
      airline
    });
  }

  return flights;
}

// ── Hotel Fetching ──────────────────────────────────────

async function fetchHotels() {
  const today = new Date();
  const checkin = today.toISOString().split('T')[0];
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const checkout = tomorrow.toISOString().split('T')[0];

  console.log(`\n🏨  Fetching hotel availability for ${checkin}...`);

  const results = [];

  for (const dest of RELOCATION_DESTINATIONS) {
    console.log(`  → ${dest.destination}`);

    try {
      const data = await rapidApiGet('/api/v1/hotels/searchHotels', {
        dest_type: 'latlong',
        latitude: dest.lat,
        longitude: dest.lng,
        search_type: 'LATLONG',
        arrival_date: checkin,
        departure_date: checkout,
        adults: 2,
        room_qty: 1,
        currency_code: 'AED',
        units: 'metric',
        temperature_unit: 'c',
        languagecode: 'en-us',
        page_number: 1
      });

      let totalHotels = 0;
      let availableHotels = 0;
      let totalPrice = 0;
      let priceCount = 0;

      if (data?.data?.hotels) {
        totalHotels = data.data.hotels.length;
        for (const hotel of data.data.hotels) {
          if (hotel.property?.priceBreakdown?.grossPrice?.value) {
            availableHotels++;
            totalPrice += hotel.property.priceBreakdown.grossPrice.value;
            priceCount++;
          }
        }
      }

      const availPct = totalHotels > 0
        ? Math.round((availableHotels / totalHotels) * 100)
        : 50; // fallback

      const avgPrice = priceCount > 0
        ? Math.round(totalPrice / priceCount)
        : 1000; // fallback

      results.push({
        destination: dest.destination,
        emirate: dest.emirate,
        lat: dest.lat,
        lng: dest.lng,
        availabilityPct: availPct,
        availabilityYesterday: 0, // Will be filled from previous day's data
        avgPriceAED: avgPrice,
        notes: ''
      });
    } catch (e) {
      console.warn(`    ${dest.destination} error:`, e.message);
      results.push({
        destination: dest.destination,
        emirate: dest.emirate,
        lat: dest.lat,
        lng: dest.lng,
        availabilityPct: 50,
        availabilityYesterday: 50,
        avgPriceAED: 1000,
        notes: 'API Error — using fallback data'
      });
    }

    await sleep(500); // Rate limiting
  }

  return results;
}

// ── Price Delta Computation ─────────────────────────────

function computeDeltas(newFlights, oldFlights, newHotels, oldHotels) {
  // Flight deltas
  for (const flight of newFlights) {
    const old = oldFlights.find(f => f.code === flight.code);
    if (old) {
      flight.dxbDeltaAED = flight.dxbPriceAED - (old.dxbPriceAED || flight.dxbPriceAED);
      flight.auhDeltaAED = flight.auhPriceAED - (old.auhPriceAED || flight.auhPriceAED);
    }
  }

  // Hotel availability deltas
  for (const hotel of newHotels) {
    const old = oldHotels.find(h => h.destination === hotel.destination);
    if (old) {
      hotel.availabilityYesterday = old.availabilityPct;
    } else {
      hotel.availabilityYesterday = hotel.availabilityPct;
    }
  }
}

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Dubai Safety Dashboard — Daily Refresh');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════');

  // Load existing data
  let existingData = {};
  try {
    existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    console.warn('No existing data file found, starting fresh.');
  }

  const oldFlights = existingData?.evacuation?.flights || [];
  const oldHotels = existingData?.evacuation?.internalRelocation || [];

  // Fetch fresh data
  const [flights, hotels] = await Promise.all([
    fetchFlights(),
    fetchHotels()
  ]);

  // Compute day-over-day deltas
  computeDeltas(flights, oldFlights, hotels, oldHotels);

  // Merge into existing data (preserving kinetic/infrastructure which are manual)
  existingData.lastUpdated = new Date().toISOString();
  existingData.evacuation = existingData.evacuation || {};
  existingData.evacuation.flights = flights;
  existingData.evacuation.internalRelocation = hotels;

  // Write updated data
  fs.writeFileSync(DATA_FILE, JSON.stringify(existingData, null, 2), 'utf8');

  console.log('\n✅ Data written to', DATA_FILE);
  console.log(`   ${flights.length} flights, ${hotels.length} relocation destinations`);

  // Summary
  const validFlights = flights.filter(f => f.dxbPriceAED > 0);
  console.log(`   ${validFlights.length}/${flights.length} flights have valid DXB prices`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

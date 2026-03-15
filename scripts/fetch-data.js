
#!/usr/bin/env node
/**
 * Daily Data Refresh Script — Multi-API Fallover Edition
 * Runs via GitHub Actions at 08:00 GST (04:00 UTC) every day.
 *
 * Fetches:
 *   1. Flight prices from DXB & AUH to all destinations
 *   2. Hotel availability in relocation cities
 *
 * API Priority Chain (Flights):
 *   1. Priceline com Provider  (priceline-com-provider.p.rapidapi.com)
 *   2. Sky Scrapper            (sky-scrapper.p.rapidapi.com)
 *   3. Booking COM             (booking-com15.p.rapidapi.com)
 *   4. Smart estimation fallback (based on distance/route)
 *
 * API Priority Chain (Hotels):
 *   1. Booking COM             (booking-com15.p.rapidapi.com)
 *   2. Priceline com Provider  (priceline-com-provider.p.rapidapi.com)
 *   3. Smart estimation fallback (based on city tier)
 *
 * Circuit Breaker: Once an API returns 429 (quota exceeded), it is
 * disabled for the remainder of the run to avoid wasting time.
 *
 * Writes updated data to: data/dashboard-state.json
 */

const fs = require('fs');
const path = require('path');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

if (!RAPIDAPI_KEY) {
  console.error('ERROR: RAPIDAPI_KEY environment variable is not set.');
  process.exit(1);
}

// ── Config ──────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, '..', 'data', 'dashboard-state.json');

// API Hosts
const HOSTS = {
  PRICELINE_PROVIDER: 'priceline-com-provider.p.rapidapi.com',
  SKY_SCRAPPER:       'sky-scrapper.p.rapidapi.com',
  BOOKING_COM:        'booking-com15.p.rapidapi.com'
};

// Circuit breaker: track which hosts are quota-exhausted
const disabledHosts = new Set();

// Flight destinations with approximate distances from DXB
const FLIGHT_DESTINATIONS = [
  { city: 'Muscat',          code: 'MCT', country: 'Oman',           distKm: 350 },
  { city: 'Frankfurt',       code: 'FRA', country: 'Germany',        distKm: 5200 },
  { city: 'Amsterdam',       code: 'AMS', country: 'Netherlands',    distKm: 5500 },
  { city: 'Paris',           code: 'CDG', country: 'France',         distKm: 5250 },
  { city: 'Rome',            code: 'FCO', country: 'Italy',          distKm: 4800 },
  { city: 'London',          code: 'LHR', country: 'United Kingdom', distKm: 5500 },
  { city: 'Lisbon',          code: 'LIS', country: 'Portugal',       distKm: 6100 },
  { city: 'Rio de Janeiro',  code: 'GIG', country: 'Brazil',         distKm: 11500 },
  { city: 'São Paulo',       code: 'GRU', country: 'Brazil',         distKm: 11300 },
  { city: 'Istanbul',        code: 'IST', country: 'Turkey',         distKm: 3000 },
  { city: 'Mumbai',          code: 'BOM', country: 'India',          distKm: 1900 },
  { city: 'Cairo',           code: 'CAI', country: 'Egypt',          distKm: 2400 },
  { city: 'Nairobi',         code: 'NBO', country: 'Kenya',          distKm: 3600 }
];

// Hotel / relocation destinations
const RELOCATION_DESTINATIONS = [
  { destination: 'Al Ain',              emirate: 'Abu Dhabi', lat: 24.2075, lng: 55.7447, tier: 'mid'    },
  { destination: 'Hatta',               emirate: 'Dubai',     lat: 24.7953, lng: 56.1097, tier: 'budget' },
  { destination: 'Dibba (Fujairah)',     emirate: 'Fujairah',  lat: 25.6189, lng: 56.2631, tier: 'budget' },
  { destination: 'Ras Al Khaimah City',  emirate: 'RAK',       lat: 25.7895, lng: 55.9432, tier: 'mid'    },
  { destination: 'Ajman City',           emirate: 'Ajman',     lat: 25.4052, lng: 55.5136, tier: 'mid'    },
  { destination: 'Fujairah City',        emirate: 'Fujairah',  lat: 25.1288, lng: 56.3264, tier: 'mid'    },
  { destination: 'Khor Fakkan',          emirate: 'Sharjah',   lat: 25.3459, lng: 56.3512, tier: 'budget' }
];

// ── API Helpers ─────────────────────────────────────────

async function apiGet(host, endpoint, params = {}) {
  // Circuit breaker: skip if host is known to be exhausted
  if (disabledHosts.has(host)) {
    return null;
  }

  const url = new URL(`https://${host}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': host
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.status === 429) {
      // Quota exceeded — enable circuit breaker for this host
      console.warn(`  ⚡ [Circuit Breaker] ${host} quota exceeded — disabling for this run`);
      disabledHosts.add(host);
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Also check for quota messages in body
      if (body.includes('exceeded') && body.includes('quota')) {
        console.warn(`  ⚡ [Circuit Breaker] ${host} quota exceeded — disabling for this run`);
        disabledHosts.add(host);
        return null;
      }
      console.warn(`  [${host}] ${endpoint} → ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      console.warn(`  [${host}] ${endpoint} → Timeout`);
    } else {
      console.warn(`  [${host}] ${endpoint} → ${e.message}`);
    }
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Flight Fetching — Multi-API Fallover ────────────────

/**
 * Strategy 1: Priceline com Provider
 * Returns prices in USD — convert to AED (1 USD ≈ 3.67 AED)
 */
async function fetchFlightPriceline(originCode, destCode, departDate) {
  if (disabledHosts.has(HOSTS.PRICELINE_PROVIDER)) return null;

  const data = await apiGet(HOSTS.PRICELINE_PROVIDER, '/v1/flights/search', {
    itinerary_type: 'ONE_WAY',
    class_type: 'ECO',
    location_departure: originCode,
    location_arrival: destCode,
    date_departure: departDate,
    number_of_passengers: 1,
    sort_order: 'PRICE'
  });

  if (data?.data?.listings?.[0]) {
    const listing = data.data.listings[0];
    const priceUSD = parseFloat(
      listing.totalPriceWithDecimal?.price ||
      listing.pricingDetail?.[0]?.totalFareAmount || 0
    );
    const priceAED = Math.round(priceUSD * 3.67);
    const airline = listing.slices?.[0]?.segments?.[0]?.legs?.[0]?.airlineName || 'Various';
    const departTime = listing.slices?.[0]?.segments?.[0]?.legs?.[0]?.departureDateTime || `${departDate}T12:00+04:00`;
    if (priceAED > 0) {
      return { price: priceAED, depart: departTime, airline, source: 'Priceline' };
    }
  }
  return null;
}

/**
 * Strategy 2: Sky Scrapper (v2 complete search)
 * Returns prices in AED directly
 */
async function fetchFlightSkyScrapper(originCode, destCode, departDate) {
  if (disabledHosts.has(HOSTS.SKY_SCRAPPER)) return null;

  // Resolve entity IDs
  const originData = await apiGet(HOSTS.SKY_SCRAPPER, '/api/v1/flights/searchAirport', {
    query: originCode, locale: 'en-US'
  });
  if (!originData) return null; // circuit breaker may have tripped

  const destData = await apiGet(HOSTS.SKY_SCRAPPER, '/api/v1/flights/searchAirport', {
    query: destCode, locale: 'en-US'
  });
  if (!destData) return null;

  const originEntity = originData?.data?.[0]?.navigation?.entityId;
  const destEntity = destData?.data?.[0]?.navigation?.entityId;
  if (!originEntity || !destEntity) return null;

  await sleep(300);

  const data = await apiGet(HOSTS.SKY_SCRAPPER, '/api/v2/flights/searchFlightsComplete', {
    originSkyId: originCode,
    destinationSkyId: destCode,
    originEntityId: originEntity,
    destinationEntityId: destEntity,
    date: departDate,
    adults: 1,
    currency: 'AED',
    market: 'AE',
    locale: 'en-US'
  });

  if (data?.data?.itineraries?.[0]) {
    const it = data.data.itineraries[0];
    const price = Math.round(it.price?.raw || 0);
    const depart = it.legs?.[0]?.departure || `${departDate}T12:00+04:00`;
    const airline = it.legs?.[0]?.carriers?.marketing?.[0]?.name || 'Various';
    if (price > 0) return { price, depart, airline, source: 'SkyScrapper' };
  }
  return null;
}

/**
 * Strategy 3: Booking COM
 */
async function fetchFlightBooking(originCode, destCode, departDate) {
  if (disabledHosts.has(HOSTS.BOOKING_COM)) return null;

  const data = await apiGet(HOSTS.BOOKING_COM, '/api/v1/flights/searchFlights', {
    fromId: `${originCode}.AIRPORT`,
    toId: `${destCode}.AIRPORT`,
    departDate,
    adults: 1,
    cabinClass: 'ECONOMY',
    currency_code: 'AED',
    sort: 'CHEAPEST'
  });

  if (data?.data?.flightOffers?.[0]) {
    const offer = data.data.flightOffers[0];
    const price = Math.round(offer.priceBreakdown?.total?.units || 0);
    const depart = offer.segments?.[0]?.departureTime || `${departDate}T12:00+04:00`;
    const airline = offer.segments?.[0]?.legs?.[0]?.carriersData?.[0]?.name || 'Various';
    if (price > 0) return { price, depart, airline, source: 'BookingCOM' };
  }
  return null;
}

/**
 * Strategy 4: Smart estimation fallback
 */
function estimateFlightPrice(distKm) {
  let rate;
  if (distKm < 1000) rate = 0.50;
  else if (distKm < 3000) rate = 0.38;
  else if (distKm < 6000) rate = 0.30;
  else rate = 0.22;

  const base = 200;
  const raw = base + (distKm * rate);
  const variance = 0.9 + (Math.random() * 0.2);
  return Math.round(raw * variance);
}

/**
 * Master flight fetcher with full fallover chain
 */
async function fetchSingleFlight(originCode, destCode, departDate, distKm) {
  let result;

  // Try Priceline first (confirmed working)
  result = await fetchFlightPriceline(originCode, destCode, departDate);
  if (result) return result;

  // Try Sky Scrapper
  result = await fetchFlightSkyScrapper(originCode, destCode, departDate);
  if (result) return result;

  // Try Booking COM
  result = await fetchFlightBooking(originCode, destCode, departDate);
  if (result) return result;

  // Final fallback: estimation
  return {
    price: estimateFlightPrice(distKm),
    depart: `${departDate}T12:00+04:00`,
    airline: 'Various',
    source: 'Estimated'
  };
}

async function fetchFlights() {
  const today = new Date();
  const departDate = today.toISOString().split('T')[0];

  console.log(`\n✈️  Fetching flights for ${departDate}...`);

  const flights = [];

  for (const dest of FLIGHT_DESTINATIONS) {
    console.log(`  → ${dest.city} (${dest.code})`);

    const dxbResult = await fetchSingleFlight('DXB', dest.code, departDate, dest.distKm);
    await sleep(1000);

    const auhResult = await fetchSingleFlight('AUH', dest.code, departDate, dest.distKm + 30);
    await sleep(1000);

    flights.push({
      city: dest.city,
      code: dest.code,
      country: dest.country,
      dxbPriceAED: dxbResult.price,
      auhPriceAED: auhResult.price,
      dxbDeltaAED: 0,
      auhDeltaAED: 0,
      dxbDepart: dxbResult.depart,
      auhDepart: auhResult.depart,
      airline: dxbResult.airline !== 'Various' ? dxbResult.airline : auhResult.airline,
      source: dxbResult.source
    });

    console.log(`    DXB: AED ${dxbResult.price} (${dxbResult.source}) | AUH: AED ${auhResult.price} (${auhResult.source})`);
  }

  return flights;
}

// ── Hotel Fetching — Multi-API Fallover ─────────────────

/**
 * Strategy 1: Booking COM hotel search
 */
async function fetchHotelBooking(lat, lng, checkin, checkout) {
  if (disabledHosts.has(HOSTS.BOOKING_COM)) return null;

  const data = await apiGet(HOSTS.BOOKING_COM, '/api/v1/hotels/searchHotels', {
    dest_type: 'latlong',
    latitude: lat,
    longitude: lng,
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

  if (data?.data?.hotels?.length > 0) {
    let totalPrice = 0, priceCount = 0, available = 0;
    const total = data.data.hotels.length;

    for (const hotel of data.data.hotels) {
      if (hotel.property?.priceBreakdown?.grossPrice?.value) {
        available++;
        totalPrice += hotel.property.priceBreakdown.grossPrice.value;
        priceCount++;
      }
    }

    if (priceCount > 0) {
      return {
        avgPrice: Math.round(totalPrice / priceCount),
        availPct: Math.round((available / total) * 100),
        source: 'BookingCOM'
      };
    }
  }
  return null;
}

/**
 * Strategy 2: Priceline com Provider hotel search
 */
async function fetchHotelPriceline(cityName, checkin, checkout) {
  if (disabledHosts.has(HOSTS.PRICELINE_PROVIDER)) return null;

  const suggest = await apiGet(HOSTS.PRICELINE_PROVIDER, '/v2/hotels/autoSuggest', {
    string: cityName + ' UAE',
    rooms: 1
  });

  const cities = suggest?.getHotelAutoSuggestV2?.results?.result?.cities;
  if (!cities) return null;

  const firstCity = Object.values(cities)[0];
  if (!firstCity?.cityid_ppn) return null;

  await sleep(500);

  const data = await apiGet(HOSTS.PRICELINE_PROVIDER, '/v1/hotels/search', {
    sort_order: 'PRICE',
    location_id: firstCity.cityid_ppn,
    date_checkin: checkin,
    date_checkout: checkout,
    rooms_number: 1,
    adults_number: 2
  });

  if (data?.hotels?.length > 0) {
    let totalPrice = 0, count = 0;
    for (const h of data.hotels) {
      const price = parseFloat(h.ratesSummary?.minPrice || 0);
      if (price > 0) {
        totalPrice += price * 3.67; // USD to AED
        count++;
      }
    }
    if (count > 0) {
      return {
        avgPrice: Math.round(totalPrice / count),
        availPct: Math.round((data.hotels.length / Math.max(1, data.totalSize || data.hotels.length)) * 100),
        source: 'Priceline'
      };
    }
  }
  return null;
}

/**
 * Strategy 3: Smart estimation fallback
 */
function estimateHotelPrice(tier) {
  const basePrices = {
    budget: { min: 180, max: 350 },
    mid:    { min: 280, max: 550 },
    luxury: { min: 500, max: 1200 }
  };
  const range = basePrices[tier] || basePrices.mid;
  return Math.round(range.min + Math.random() * (range.max - range.min));
}

function estimateAvailability() {
  return Math.round(40 + Math.random() * 45);
}

async function fetchSingleHotel(dest, checkin, checkout) {
  let result;

  result = await fetchHotelBooking(dest.lat, dest.lng, checkin, checkout);
  if (result) return result;

  result = await fetchHotelPriceline(dest.destination, checkin, checkout);
  if (result) return result;

  return {
    avgPrice: estimateHotelPrice(dest.tier),
    availPct: estimateAvailability(),
    source: 'Estimated'
  };
}

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

    const hotelData = await fetchSingleHotel(dest, checkin, checkout);

    results.push({
      destination: dest.destination,
      emirate: dest.emirate,
      lat: dest.lat,
      lng: dest.lng,
      availabilityPct: hotelData.availPct,
      availabilityYesterday: 0,
      avgPriceAED: hotelData.avgPrice,
      notes: hotelData.source === 'Estimated'
        ? `Estimated (${dest.tier} tier) — APIs quota-limited`
        : `Live data via ${hotelData.source}`
    });

    console.log(`    AED ${hotelData.avgPrice}/night, ${hotelData.availPct}% avail (${hotelData.source})`);
    await sleep(1500);
  }

  return results;
}

// ── Price Delta Computation ─────────────────────────────

function computeDeltas(newFlights, oldFlights, newHotels, oldHotels) {
  for (const flight of newFlights) {
    const old = oldFlights.find(f => f.code === flight.code);
    if (old) {
      flight.dxbDeltaAED = flight.dxbPriceAED - (old.dxbPriceAED || flight.dxbPriceAED);
      flight.auhDeltaAED = flight.auhPriceAED - (old.auhPriceAED || flight.auhPriceAED);
    }
  }

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
  console.log('  Multi-API Fallover Edition');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════');

  let existingData = {};
  try {
    existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    console.warn('No existing data file found, starting fresh.');
  }

  const oldFlights = existingData?.evacuation?.flights || [];
  const oldHotels = existingData?.evacuation?.internalRelocation || [];

  // Fetch fresh data sequentially to respect rate limits
  const flights = await fetchFlights();
  const hotels = await fetchHotels();

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

  const liveFlights = flights.filter(f => f.source !== 'Estimated');
  const liveHotels = hotels.filter(h => !h.notes.includes('Estimated'));
  console.log(`   Flights: ${liveFlights.length}/${flights.length} from live APIs`);
  console.log(`   Hotels:  ${liveHotels.length}/${hotels.length} from live APIs`);

  if (disabledHosts.size > 0) {
    console.log(`   ⚡ Circuit breakers tripped: ${[...disabledHosts].join(', ')}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

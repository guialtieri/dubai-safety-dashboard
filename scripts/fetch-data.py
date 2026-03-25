#!/usr/bin/env python3
import os
import json
import time
import random
import datetime
import urllib.request
import urllib.parse
from urllib.error import URLError, HTTPError

RAPIDAPI_KEY = os.environ.get('RAPIDAPI_KEY')
if not RAPIDAPI_KEY:
    print("ERROR: RAPIDAPI_KEY environment variable is not set. Using estimation strategy.")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'dashboard-state.json')

HOSTS = {
    'PRICELINE_PROVIDER': 'priceline-com-provider.p.rapidapi.com',
    'SKY_SCRAPPER': 'sky-scrapper.p.rapidapi.com',
    'BOOKING_COM': 'booking-com15.p.rapidapi.com'
}

disabledHosts = set()

FLIGHT_DESTINATIONS = [
  { 'city': 'Muscat',          'code': 'MCT', 'country': 'Oman',           'distKm': 350 },
  { 'city': 'Frankfurt',       'code': 'FRA', 'country': 'Germany',        'distKm': 5200 },
  { 'city': 'Amsterdam',       'code': 'AMS', 'country': 'Netherlands',    'distKm': 5500 },
  { 'city': 'Paris',           'code': 'CDG', 'country': 'France',         'distKm': 5250 },
  { 'city': 'Rome',            'code': 'FCO', 'country': 'Italy',          'distKm': 4800 },
  { 'city': 'London',          'code': 'LHR', 'country': 'United Kingdom', 'distKm': 5500 },
  { 'city': 'Lisbon',          'code': 'LIS', 'country': 'Portugal',       'distKm': 6100 },
  { 'city': 'Rio de Janeiro',  'code': 'GIG', 'country': 'Brazil',         'distKm': 11500 },
  { 'city': 'São Paulo',       'code': 'GRU', 'country': 'Brazil',         'distKm': 11300 },
  { 'city': 'Istanbul',        'code': 'IST', 'country': 'Turkey',         'distKm': 3000 },
  { 'city': 'Mumbai',          'code': 'BOM', 'country': 'India',          'distKm': 1900 },
  { 'city': 'Cairo',           'code': 'CAI', 'country': 'Egypt',          'distKm': 2400 },
  { 'city': 'Nairobi',         'code': 'NBO', 'country': 'Kenya',          'distKm': 3600 }
]

RELOCATION_DESTINATIONS = [
  { 'destination': 'Al Ain',              'emirate': 'Abu Dhabi', 'lat': 24.2075, 'lng': 55.7447, 'tier': 'mid'    },
  { 'destination': 'Hatta',               'emirate': 'Dubai',     'lat': 24.7953, 'lng': 56.1097, 'tier': 'budget' },
  { 'destination': 'Dibba (Fujairah)',    'emirate': 'Fujairah',  'lat': 25.6189, 'lng': 56.2631, 'tier': 'budget' },
  { 'destination': 'Ras Al Khaimah City', 'emirate': 'RAK',       'lat': 25.7895, 'lng': 55.9432, 'tier': 'mid'    },
  { 'destination': 'Ajman City',          'emirate': 'Ajman',     'lat': 25.4052, 'lng': 55.5136, 'tier': 'mid'    },
  { 'destination': 'Fujairah City',       'emirate': 'Fujairah',  'lat': 25.1288, 'lng': 56.3264, 'tier': 'mid'    },
  { 'destination': 'Khor Fakkan',         'emirate': 'Sharjah',   'lat': 25.3459, 'lng': 56.3512, 'tier': 'budget' }
]

def api_get(host, endpoint, params={}):
    if host in disabledHosts or not RAPIDAPI_KEY:
        return None

    query_string = urllib.parse.urlencode(params)
    url = f"https://{host}{endpoint}?{query_string}"
    
    req = urllib.request.Request(url, headers={
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': host
    })
    
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            body = response.read().decode('utf-8')
            return json.loads(body)
    except HTTPError as e:
        if e.code == 429:
            print(f"  ⚡ [Circuit Breaker] {host} quota exceeded — disabling for this run")
            disabledHosts.add(host)
            return None
            
        try:
            body = e.read().decode('utf-8', errors='ignore')
            if 'exceeded' in body and 'quota' in body:
                print(f"  ⚡ [Circuit Breaker] {host} quota exceeded — disabling for this run")
                disabledHosts.add(host)
                return None
        except:
            pass
            
        print(f"  [{host}] {endpoint} → {e.code}")
        return None
    except URLError as e:
        print(f"  [{host}] {endpoint} → {e.reason}")
        return None
    except Exception as e:
        print(f"  [{host}] {endpoint} → {e}")
        return None

def fetch_flight_priceline(origin_code, dest_code, depart_date):
    if HOSTS['PRICELINE_PROVIDER'] in disabledHosts:
        return None
        
    data = api_get(HOSTS['PRICELINE_PROVIDER'], '/v1/flights/search', {
        'itinerary_type': 'ONE_WAY',
        'class_type': 'ECO',
        'location_departure': origin_code,
        'location_arrival': dest_code,
        'date_departure': depart_date,
        'number_of_passengers': 1,
        'sort_order': 'PRICE'
    })
    
    try:
        if data and 'data' in data and data['data'].get('listings'):
            listing = data['data']['listings'][0]
            price_usd = 0
            if listing.get('totalPriceWithDecimal', {}).get('price'):
                price_usd = float(listing['totalPriceWithDecimal']['price'])
            elif listing.get('pricingDetail', []) and len(listing['pricingDetail']) > 0:
                price_usd = float(listing['pricingDetail'][0].get('totalFareAmount', 0))
                
            price_aed = round(price_usd * 3.67)
            airline = listing.get('slices', [{}])[0].get('segments', [{}])[0].get('legs', [{}])[0].get('airlineName', 'Various')
            depart_time = listing.get('slices', [{}])[0].get('segments', [{}])[0].get('legs', [{}])[0].get('departureDateTime', f"{depart_date}T12:00+04:00")
            
            if price_aed > 0:
                return { 'price': price_aed, 'depart': depart_time, 'airline': airline, 'source': 'Priceline' }
    except Exception:
        pass
    return None

def fetch_flight_skyscrapper(origin_code, dest_code, depart_date):
    if HOSTS['SKY_SCRAPPER'] in disabledHosts:
        return None

    origin_data = api_get(HOSTS['SKY_SCRAPPER'], '/api/v1/flights/searchAirport', {'query': origin_code, 'locale': 'en-US'})
    if not origin_data: return None
    
    dest_data = api_get(HOSTS['SKY_SCRAPPER'], '/api/v1/flights/searchAirport', {'query': dest_code, 'locale': 'en-US'})
    if not dest_data: return None
    
    origin_entity = None
    try:
        origin_entity = origin_data['data'][0]['navigation']['entityId']
    except (KeyError, IndexError, TypeError):
        pass
        
    dest_entity = None
    try:
        dest_entity = dest_data['data'][0]['navigation']['entityId']
    except (KeyError, IndexError, TypeError):
        pass
        
    if not origin_entity or not dest_entity:
        return None
        
    time.sleep(0.3)
    
    data = api_get(HOSTS['SKY_SCRAPPER'], '/api/v2/flights/searchFlightsComplete', {
        'originSkyId': origin_code,
        'destinationSkyId': dest_code,
        'originEntityId': origin_entity,
        'destinationEntityId': dest_entity,
        'date': depart_date,
        'adults': 1,
        'currency': 'AED',
        'market': 'AE',
        'locale': 'en-US'
    })
    
    try:
        if data and 'data' in data and data['data'].get('itineraries'):
            it = data['data']['itineraries'][0]
            price = round(it.get('price', {}).get('raw', 0))
            depart = it.get('legs', [{}])[0].get('departure', f"{depart_date}T12:00+04:00")
            
            airline = 'Various'
            try:
                airline = it['legs'][0]['carriers']['marketing'][0]['name']
            except (KeyError, IndexError, TypeError):
                pass
                
            if price > 0:
                return { 'price': price, 'depart': depart, 'airline': airline, 'source': 'SkyScrapper' }
    except Exception:
        pass
    return None

def fetch_flight_booking(origin_code, dest_code, depart_date):
    if HOSTS['BOOKING_COM'] in disabledHosts:
        return None
        
    data = api_get(HOSTS['BOOKING_COM'], '/api/v1/flights/searchFlights', {
        'fromId': f"{origin_code}.AIRPORT",
        'toId': f"{dest_code}.AIRPORT",
        'departDate': depart_date,
        'adults': 1,
        'cabinClass': 'ECONOMY',
        'currency_code': 'AED',
        'sort': 'CHEAPEST'
    })
    
    try:
        if data and 'data' in data and data['data'].get('flightOffers'):
            offer = data['data']['flightOffers'][0]
            price = round(offer.get('priceBreakdown', {}).get('total', {}).get('units', 0))
            depart = offer.get('segments', [{}])[0].get('departureTime', f"{depart_date}T12:00+04:00")
            
            airline = 'Various'
            try:
                airline = offer['segments'][0]['legs'][0]['carriersData'][0]['name']
            except (KeyError, IndexError, TypeError):
                pass
                
            if price > 0:
                return { 'price': price, 'depart': depart, 'airline': airline, 'source': 'BookingCOM' }
    except Exception:
        pass
    return None

def estimate_flight_price(dist_km):
    if dist_km < 1000: rate = 0.50
    elif dist_km < 3000: rate = 0.38
    elif dist_km < 6000: rate = 0.30
    else: rate = 0.22
    
    base = 200
    raw = base + (dist_km * rate)
    variance = 0.9 + (random.random() * 0.2)
    return round(raw * variance)

def fetch_single_flight(origin_code, dest_code, depart_date, dist_km):
    res = fetch_flight_priceline(origin_code, dest_code, depart_date)
    if res: return res
    
    res = fetch_flight_skyscrapper(origin_code, dest_code, depart_date)
    if res: return res
    
    res = fetch_flight_booking(origin_code, dest_code, depart_date)
    if res: return res
    
    return {
        'price': estimate_flight_price(dist_km),
        'depart': f"{depart_date}T12:00+04:00",
        'airline': 'Various',
        'source': 'Estimated'
    }

def fetch_flights():
    today = datetime.datetime.now()
    depart_date = today.strftime('%Y-%m-%d')
    
    print(f"\n✈️  Fetching flights for {depart_date}...")
    
    flights = []
    
    for dest in FLIGHT_DESTINATIONS:
        print(f"  → {dest['city']} ({dest['code']})")
        
        dxb_result = fetch_single_flight('DXB', dest['code'], depart_date, dest['distKm'])
        time.sleep(1)
        
        auh_result = fetch_single_flight('AUH', dest['code'], depart_date, dest['distKm'] + 30)
        time.sleep(1)
        
        airline = dxb_result['airline'] if dxb_result['airline'] != 'Various' else auh_result['airline']
        
        flights.append({
            'city': dest['city'],
            'code': dest['code'],
            'country': dest['country'],
            'dxbPriceAED': dxb_result['price'],
            'auhPriceAED': auh_result['price'],
            'dxbDeltaAED': 0,
            'auhDeltaAED': 0,
            'dxbDepart': dxb_result['depart'],
            'auhDepart': auh_result['depart'],
            'airline': airline,
            'source': dxb_result['source']
        })
        
        print(f"    DXB: AED {dxb_result['price']} ({dxb_result['source']}) | AUH: AED {auh_result['price']} ({auh_result['source']})")
        
    return flights

def fetch_hotel_booking(lat, lng, checkin, checkout):
    if HOSTS['BOOKING_COM'] in disabledHosts:
        return None
        
    data = api_get(HOSTS['BOOKING_COM'], '/api/v1/hotels/searchHotels', {
        'dest_type': 'latlong',
        'latitude': lat,
        'longitude': lng,
        'search_type': 'LATLONG',
        'arrival_date': checkin,
        'departure_date': checkout,
        'adults': 2,
        'room_qty': 1,
        'currency_code': 'AED',
        'units': 'metric',
        'temperature_unit': 'c',
        'languagecode': 'en-us',
        'page_number': 1
    })
    
    try:
        if data and 'data' in data and data['data'].get('hotels') and len(data['data']['hotels']) > 0:
            total_price = 0
            price_count = 0
            available = 0
            total = len(data['data']['hotels'])
            
            for hotel in data['data']['hotels']:
                val = hotel.get('property', {}).get('priceBreakdown', {}).get('grossPrice', {}).get('value')
                if val:
                    available += 1
                    total_price += val
                    price_count += 1
                    
            if price_count > 0:
                return {
                    'avgPrice': round(total_price / price_count),
                    'availPct': round((available / total) * 100),
                    'source': 'BookingCOM'
                }
    except Exception:
        pass
    return None

def fetch_hotel_priceline(city_name, checkin, checkout):
    if HOSTS['PRICELINE_PROVIDER'] in disabledHosts:
        return None
        
    suggest = api_get(HOSTS['PRICELINE_PROVIDER'], '/v2/hotels/autoSuggest', {
        'string': f"{city_name} UAE",
        'rooms': 1
    })
    
    try:
        cities = suggest.get('getHotelAutoSuggestV2', {}).get('results', {}).get('result', {}).get('cities', {})
        if not cities: return None
        
        first_city = list(cities.values())[0]
        city_id = first_city.get('cityid_ppn')
        if not city_id: return None
        
        time.sleep(0.5)
        
        data = api_get(HOSTS['PRICELINE_PROVIDER'], '/v1/hotels/search', {
            'sort_order': 'PRICE',
            'location_id': city_id,
            'date_checkin': checkin,
            'date_checkout': checkout,
            'rooms_number': 1,
            'adults_number': 2
        })
        
        if data and data.get('hotels') and len(data['hotels']) > 0:
            total_price = 0
            count = 0
            for h in data['hotels']:
                price = float(h.get('ratesSummary', {}).get('minPrice', 0))
                if price > 0:
                    total_price += price * 3.67
                    count += 1
            if count > 0:
                avail_pct = round((len(data['hotels']) / max(1, data.get('totalSize', len(data['hotels'])))) * 100)
                return {
                    'avgPrice': round(total_price / count),
                    'availPct': avail_pct,
                    'source': 'Priceline'
                }
    except Exception:
        pass
    return None

def estimate_hotel_price(tier):
    base_prices = {
        'budget': {'min': 180, 'max': 350},
        'mid':    {'min': 280, 'max': 550},
        'luxury': {'min': 500, 'max': 1200}
    }
    r = base_prices.get(tier, base_prices['mid'])
    return round(r['min'] + random.random() * (r['max'] - r['min']))

def estimate_availability():
    return round(40 + random.random() * 45)

def fetch_single_hotel(dest, checkin, checkout):
    res = fetch_hotel_booking(dest['lat'], dest['lng'], checkin, checkout)
    if res: return res
    
    res = fetch_hotel_priceline(dest['destination'], checkin, checkout)
    if res: return res
    
    return {
        'avgPrice': estimate_hotel_price(dest['tier']),
        'availPct': estimate_availability(),
        'source': 'Estimated'
    }

def fetch_hotels():
    today = datetime.datetime.now()
    checkin = today.strftime('%Y-%m-%d')
    tomorrow = today + datetime.timedelta(days=1)
    checkout = tomorrow.strftime('%Y-%m-%d')
    
    print(f"\n🏨  Fetching hotel availability for {checkin}...")
    
    results = []
    
    for dest in RELOCATION_DESTINATIONS:
        print(f"  → {dest['destination']}")
        
        hotel_data = fetch_single_hotel(dest, checkin, checkout)
        
        notes = f"Estimated ({dest['tier']} tier) — APIs quota-limited" if hotel_data['source'] == 'Estimated' else f"Live data via {hotel_data['source']}"
        
        results.append({
            'destination': dest['destination'],
            'emirate': dest['emirate'],
            'lat': dest['lat'],
            'lng': dest['lng'],
            'availabilityPct': hotel_data['availPct'],
            'availabilityYesterday': 0,
            'avgPriceAED': hotel_data['avgPrice'],
            'notes': notes
        })
        
        print(f"    AED {hotel_data['avgPrice']}/night, {hotel_data['availPct']}% avail ({hotel_data['source']})")
        time.sleep(1.5)
        
    return results

def compute_deltas(new_flights, old_flights, new_hotels, old_hotels):
    for flight in new_flights:
        old = next((f for f in old_flights if f.get('code') == flight['code']), None)
        if old:
            flight['dxbDeltaAED'] = flight['dxbPriceAED'] - old.get('dxbPriceAED', flight['dxbPriceAED'])
            flight['auhDeltaAED'] = flight['auhPriceAED'] - old.get('auhPriceAED', flight['auhPriceAED'])
            
    for hotel in new_hotels:
        old = next((h for h in old_hotels if h.get('destination') == hotel['destination']), None)
        if old:
            hotel['availabilityYesterday'] = old.get('availabilityPct', hotel['availabilityPct'])
        else:
            hotel['availabilityYesterday'] = hotel['availabilityPct']

def main():
    print('═══════════════════════════════════════════')
    print('  Dubai Safety Dashboard — Daily Refresh')
    print('  Multi-API Fallover Edition (Python Native)')
    print(f"  {datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')}")
    print('═══════════════════════════════════════════')
    
    existing_data = {}
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            existing_data = json.load(f)
    except Exception:
        print("Empty or invalid current data file, starting fresh.")
        
    old_flights = existing_data.get('evacuation', {}).get('flights', [])
    old_hotels = existing_data.get('evacuation', {}).get('internalRelocation', [])
    
    flights = fetch_flights()
    hotels = fetch_hotels()
    
    compute_deltas(flights, old_flights, hotels, old_hotels)
    
    existing_data['lastUpdated'] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
    if 'evacuation' not in existing_data:
        existing_data['evacuation'] = {}
        
    existing_data['evacuation']['flights'] = flights
    existing_data['evacuation']['internalRelocation'] = hotels
    
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, indent=2)
        
    print(f"\n✅ Data written to {DATA_FILE}")
    print(f"   {len(flights)} flights, {len(hotels)} relocation destinations")
    
    live_flights = [f for f in flights if f['source'] != 'Estimated']
    live_hotels = [h for h in hotels if 'Estimated' not in h['notes']]
    print(f"   Flights: {len(live_flights)}/{len(flights)} from live APIs")
    print(f"   Hotels:  {len(live_hotels)}/{len(hotels)} from live APIs")
    
    if disabledHosts:
        print(f"   ⚡ Circuit breakers tripped: {', '.join(list(disabledHosts))}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        import sys
        sys.exit(1)

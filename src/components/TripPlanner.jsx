import React, { useState, useMemo } from 'react';

export default function TripPlanner() {
  const [istToMunFlight, setIstToMunFlight] = useState('6:45');
  const [munToMilanTime, setMunToMilanTime] = useState('evening');
  const [milanStayDays, setMilanStayDays] = useState(3);

  const flights = {
    '6:45': { arrival: '11:30', duration: '2h 45min', cost: '€2,100', airline: 'Turkish Airlines' },
    '7:25': { arrival: '9:05', duration: '1h 40min', cost: '€2,800', airline: 'Turkish Airlines' },
    '10:00': { arrival: '11:45', duration: '1h 45min', cost: '€34,500', airline: 'Turkish Airlines' }
  };

  const munToMilanOptions = {
    evening: { departure: '18:00–20:00', arrival: '02:00–04:00', duration: '7–8 hours', nextDay: true },
    morning: { departure: '08:00–10:00', arrival: '15:00–17:00', duration: '7–8 hours', nextDay: false }
  };

  const calculateItinerary = useMemo(() => {
    const flight = flights[istToMunFlight];
    const munMilan = munToMilanOptions[munToMilanTime];
    
    return {
      outbound: {
        route: 'IST → MUN',
        departure: istToMunFlight,
        arrival: flight.arrival,
        cost: flight.cost,
        airline: flight.airline,
        duration: flight.duration
      },
      munDay: {
        arrival: flight.arrival,
        activities: '1 day in Munich (sightseeing, rest, family time)',
        departure: munToMilanTime === 'evening' ? 'Evening (18:00–20:00)' : 'Next morning (08:00–10:00)',
      },
      munToMilan: {
        route: 'MUN → MILAN (Train)',
        departure: munMilan.departure,
        arrival: munMilan.arrival,
        duration: munMilan.duration,
        cost: '€250–350',
      },
      milanStay: {
        days: milanStayDays,
        notes: `${milanStayDays} ${milanStayDays === 1 ? 'day' : 'days'} exploring Milan`
      }
    };
  }, [istToMunFlight, munToMilanTime, milanStayDays]);

  const totalCost = {
    estimatedTotal: parseInt(calculateItinerary.outbound.cost.replace(/€|,/g, '')) + 300
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-light tracking-tight text-slate-900 mb-2">
            IST → MUN → MILAN → IST
          </h1>
          <p className="text-sm md:text-base text-slate-600">
            Optimize your Europe trip. Adjust time windows to find your ideal itinerary.
          </p>
        </div>

        {/* Control Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          
          {/* Flight Selection */}
          <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
            <label className="block text-xs font-semibold text-slate-900 mb-3 uppercase tracking-wide">
              🕐 IST → MUN Flight
            </label>
            <select
              value={istToMunFlight}
              onChange={(e) => setIstToMunFlight(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-900 text-sm"
            >
              {Object.entries(flights).map(([time, details]) => (
                <option key={time} value={time}>
                  {time} → {details.arrival} ({details.cost})
                </option>
              ))}
            </select>
            <div className="mt-3 text-xs text-slate-600 space-y-1">
              <p><strong>Duration:</strong> {flights[istToMunFlight].duration}</p>
              <p><strong>Airline:</strong> {flights[istToMunFlight].airline}</p>
            </div>
          </div>

          {/* MUN to MILAN Travel Time */}
          <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
            <label className="block text-xs font-semibold text-slate-900 mb-3 uppercase tracking-wide">
              🕐 MUN → MILAN Departure
            </label>
            <div className="space-y-2">
              {Object.entries(munToMilanOptions).map(([key, details]) => (
                <button
                  key={key}
                  onClick={() => setMunToMilanTime(key)}
                  className={`w-full text-left px-3 py-2 rounded-lg border-2 transition-all text-xs ${
                    munToMilanTime === key
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <p className="font-semibold text-slate-900 capitalize">{key}</p>
                  <p className="text-xs text-slate-600">{details.departure}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Milan Stay Duration */}
          <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
            <label className="block text-xs font-semibold text-slate-900 mb-3 uppercase tracking-wide">
              📍 Milan Stay Duration
            </label>
            <input
              type="range"
              min="1"
              max="7"
              value={milanStayDays}
              onChange={(e) => setMilanStayDays(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <p className="text-center mt-3 text-2xl font-light text-slate-900">{milanStayDays} days</p>
          </div>
        </div>

        {/* Itinerary Timeline */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 md:p-6 mb-8">
          <h2 className="text-xl font-light text-slate-900 mb-6">Your Itinerary</h2>
          
          <div className="space-y-6">
            
            {/* Day 1: Flight */}
            <div className="flex gap-3 md:gap-4">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-9 md:w-10 h-9 md:h-10 rounded-full bg-blue-500 text-white flex items-center justify-center font-semibold text-sm">1</div>
                <div className="w-1 h-12 bg-slate-300 mt-1"></div>
              </div>
              <div className="pb-6 flex-1 min-w-0">
                <h3 className="text-sm md:text-base font-semibold text-slate-900 mb-2">Flight: Istanbul → Munich</h3>
                <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                  <div>
                    <p className="text-slate-600">Departure</p>
                    <p className="font-semibold text-slate-900">{calculateItinerary.outbound.departure}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">Arrival</p>
                    <p className="font-semibold text-slate-900">{calculateItinerary.outbound.arrival}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">Cost</p>
                    <p className="font-semibold text-slate-900">{calculateItinerary.outbound.cost}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">Airline</p>
                    <p className="font-semibold text-slate-900 text-xs">{calculateItinerary.outbound.airline}</p>
                  </div>
                </div>
                <div className="p-2 bg-blue-50 rounded text-xs text-blue-900 border border-blue-200">
                  ✓ S-Bahn to Munich city (~1 hour)
                </div>
              </div>
            </div>

            {/* Day 2: Munich */}
            <div className="flex gap-3 md:gap-4">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-9 md:w-10 h-9 md:h-10 rounded-full bg-green-500 text-white flex items-center justify-center font-semibold text-sm">2</div>
                <div className="w-1 h-12 bg-slate-300 mt-1"></div>
              </div>
              <div className="pb-6 flex-1 min-w-0">
                <h3 className="text-sm md:text-base font-semibold text-slate-900 mb-2">Munich (1 Day)</h3>
                <p className="text-slate-600 mb-2 text-xs">{calculateItinerary.munDay.activities}</p>
                <div className="p-2 bg-green-50 rounded text-xs text-green-900 border border-green-200 mb-2">
                  ⚠ Rest day with infant. Keep activities close to city.
                </div>
                <p className="text-xs text-slate-600">
                  <strong>Train Departure:</strong> {calculateItinerary.munDay.departure}
                </p>
              </div>
            </div>

            {/* Day 3: Travel Day */}
            <div className="flex gap-3 md:gap-4">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-9 md:w-10 h-9 md:h-10 rounded-full bg-amber-500 text-white flex items-center justify-center font-semibold text-sm">3</div>
                <div className="w-1 h-12 bg-slate-300 mt-1"></div>
              </div>
              <div className="pb-6 flex-1 min-w-0">
                <h3 className="text-sm md:text-base font-semibold text-slate-900 mb-2">Train: Munich → Milan</h3>
                <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                  <div>
                    <p className="text-slate-600">Departure</p>
                    <p className="font-semibold text-slate-900">{calculateItinerary.munToMilan.departure}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">Arrival</p>
                    <p className="font-semibold text-slate-900">{calculateItinerary.munToMilan.arrival}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">Duration</p>
                    <p className="font-semibold text-slate-900">{calculateItinerary.munToMilan.duration}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">Cost (est.)</p>
                    <p className="font-semibold text-slate-900">{calculateItinerary.munToMilan.cost}</p>
                  </div>
                </div>
                <div className="p-2 bg-amber-50 rounded text-xs text-amber-900 border border-amber-200">
                  ✓ MXP (Malpensa) — Train to Milan city (23 min)
                </div>
              </div>
            </div>

            {/* Days 4+: Milan */}
            <div className="flex gap-3 md:gap-4">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-9 md:w-10 h-9 md:h-10 rounded-full bg-purple-500 text-white flex items-center justify-center font-semibold text-xs md:text-sm">4–{3 + calculateItinerary.milanStay.days}</div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm md:text-base font-semibold text-slate-900 mb-2">Milan ({calculateItinerary.milanStay.days} {calculateItinerary.milanStay.days === 1 ? 'Day' : 'Days'})</h3>
                <p className="text-slate-600 mb-2 text-xs">{calculateItinerary.milanStay.notes}</p>
                <div className="p-3 bg-purple-50 rounded text-xs text-purple-900 border border-purple-200">
                  <strong>Recommended:</strong> Family-friendly attractions, parks, duomo, day trips
                </div>
              </div>
            </div>

            {/* Return Flight */}
            <div className="flex gap-3 md:gap-4">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-9 md:w-10 h-9 md:h-10 rounded-full bg-red-500 text-white flex items-center justify-center font-semibold text-sm">✈</div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm md:text-base font-semibold text-slate-900 mb-1">Return Flight: Milan → Istanbul</h3>
                <p className="text-slate-600 mb-1 text-xs">Return flight TBD based on Milan departure date</p>
                <p className="text-xs text-slate-600">
                  <strong>Airport:</strong> MXP (Malpensa) - Train access
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Cost Breakdown & Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <h3 className="text-sm font-semibold text-blue-900 mb-3">
              💶 Estimated Costs
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-blue-800">IST → MUN Flight</span>
                <span className="font-semibold text-blue-900">{calculateItinerary.outbound.cost}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-blue-800">MUN → MILAN Train</span>
                <span className="font-semibold text-blue-900">€250–350</span>
              </div>
              <div className="flex justify-between">
                <span className="text-blue-800">MILAN → IST Return</span>
                <span className="font-semibold text-blue-900">TBD</span>
              </div>
              <hr className="border-blue-300 my-2" />
              <div className="flex justify-between">
                <span className="font-semibold text-blue-900">Flights + Train</span>
                <span className="font-bold text-blue-900">€{(totalCost.estimatedTotal).toLocaleString()}</span>
              </div>
            </div>
            <p className="text-xs text-blue-700 mt-2">* Excludes return flight, hotels, meals, activities</p>
          </div>

          {/* Trip Summary */}
          <div className="bg-slate-100 rounded-lg p-4 border border-slate-300">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Trip Summary</h3>
            <div className="space-y-2 text-xs">
              <div>
                <p className="text-slate-600">Total Duration</p>
                <p className="font-semibold text-slate-900">{3 + calculateItinerary.milanStay.days} days</p>
              </div>
              <div>
                <p className="text-slate-600">Munich</p>
                <p className="font-semibold text-slate-900">1 day</p>
              </div>
              <div>
                <p className="text-slate-600">Milan</p>
                <p className="font-semibold text-slate-900">{calculateItinerary.milanStay.days} days</p>
              </div>
              <div>
                <p className="text-slate-600">Traveling With</p>
                <p className="font-semibold text-slate-900">Infant</p>
              </div>
              <div>
                <p className="text-slate-600">Transport</p>
                <p className="font-semibold text-slate-900">Train-focused</p>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
          <h3 className="text-xs font-semibold text-amber-900 mb-2 uppercase tracking-wide">
            ⚠ Trip Planning Notes
          </h3>
          <ul className="text-xs text-amber-900 space-y-1 list-disc list-inside">
            <li><strong>Infant-friendly:</strong> MXP (train) preferred over BGY (bus)</li>
            <li><strong>Munich:</strong> 1 day allows arrival rest + quick visit</li>
            <li><strong>Train:</strong> Choose evening (overnight) or morning (daytime)</li>
            <li><strong>Booking:</strong> Book hotels near transit for flexibility</li>
          </ul>
        </div>

      </div>
    </div>
  );
}

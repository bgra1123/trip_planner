# Trip Planner: IST → MUN → MILAN

An interactive React-based trip planning tool that optimizes your Europe itinerary with real-time calculations for flights, train travel, and stay duration adjustments.

## 🎯 Features

- **Real-time Itinerary Optimization**: Adjust time windows and see cost/duration changes instantly
- **Flight Selection**: Choose from multiple departure times with different pricing
- **Train Travel Planning**: Select evening (overnight) or morning (daytime) departure from Munich to Milan
- **Flexible Stay Duration**: Drag slider to adjust Milan stay (1–7 days)
- **Family-Friendly Recommendations**: Optimized for travel with infant
- **Cost Breakdown**: Real-time cost estimation for flights and train
- **Multi-Currency**: Mix EUR, USD, GBP, TRY and CHF; set `RATE:` lines to fold them into one total
- **Price Capture**: Right-click any price, scrape supported portals, or search flights via the backend
- **Responsive Design**: Works seamlessly on mobile (iOS), tablet, and desktop

## 📋 Route Overview

```
Istanbul (IST) 
  ↓ Flight
Munich (MUN) - 1 Day
  ↓ Train (7–8 hours)
Milan (MILAN) - Configurable (1–7 days)
  ↓ Flight
Istanbul (IST)
```

## 🚀 Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/bgra1123/trip_planner.git
cd trip_planner
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

Want to plan a real trip with your own captured portal offers? See
[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) for the full walkthrough —
loading the extension, capturing from Capital One/Amex or any site, tagging a
hotel with its card program, and letting the planner rank the combinations.

## 📱 Using on iOS (Claude App)

1. Open **Claude** on your iPhone
2. Tap the **Code** icon
3. The app runs interactively with real-time state updates
4. Adjust controls to optimize your itinerary

## 📲 Add to your iPhone home screen

The app is a installable web app: open it in Safari, tap **Share** →
**Add to Home Screen**, and it launches full-screen with its own icon, no
address bar. This works for the planner itself; it does **not** apply to the
Chrome extension — see [extension/README.md](extension/README.md) for why
browser extensions can't run on iPhone and what capture looks like there
instead.

## 🛠️ Project Structure

```
trip_planner/
├── src/
│   ├── components/
│   │   ├── TripPlanner.jsx       # Main component
│   │   └── TripAgentPanel.jsx    # Staging panel for captured offers
│   ├── hooks/
│   │   └── useTripAgent.js       # Collects offers from extension + backend
│   ├── utils/
│   │   ├── parseTripNotes.js     # Notes parsing, cost model, export
│   │   ├── tripAgentOffers.js    # Offer normalization → editable rows
│   │   ├── tripAgentBridge.js    # Page half of the extension bridge
│   │   └── tripAgentApi.js       # Backend client
│   ├── App.jsx                   # App wrapper
│   ├── App.css                   # Component styles
│   ├── index.jsx                 # Entry point
│   └── index.css                 # Global styles
├── extension/                    # Browser extension (MV3) — see its README
│   ├── lib/capture.js            # Notes-line formatting, shared by worker + popup
│   └── scrapers.js               # Site adapters, JSON-LD + text heuristics
├── backend/                      # Flight-search proxy — see its README
├── scripts/
│   ├── generate-report.mjs       # Notes → trip-plan.json/.md, no browser
│   ├── extract-screenshot.mjs    # Screenshot → trip notes, via the Claude API
│   ├── tripagent-selftest.mjs    # Data-pipeline checks
│   └── tripagent-browser-test.mjs# Bridge checks in a real browser
├── docs/
│   └── TRIPAGENT-INTEGRATION.md  # Architecture and data contract
├── public/
│   └── index.html                # HTML template
├── package.json                  # Dependencies
├── .gitignore                    # Git ignore rules
├── README.md                     # This file
└── LICENSE                       # MIT License
```

## 🔌 Getting prices into the app

Typing every fare by hand doesn't scale, so there are four ways in — no single
one covers every site, which is exactly why there are several.

| Tool | Works on | Effort | Breaks when |
|------|----------|--------|-------------|
| **Right-click capture** (`extension/`) | any page, anywhere | select a price, right-click | never |
| **Capture this page** (`extension/`) | any page, anywhere | click one button | a page has no readable prices |
| **Automatic scraping** (`extension/`) | Google Flights, Kayak, Skyscanner, Booking.com, Trainline, DB | none | a site redesigns |
| **Bank travel portals** (`extension/` + `backend/`) | Capital One, Amex — in your logged-in session | none | a portal redesigns |
| **Backend flight search** (`backend/`) | Amadeus, via `npm run backend` | fill a form | an API key expires |
| **Screenshot transcription** (`scripts/extract-screenshot.mjs`) | a screenshot or a photo of handwritten notes | run the CLI | needs `ANTHROPIC_API_KEY` |

The extension is not restricted to a list of sites: the first two rows work on
whatever page you have open. The site-specific rows only buy *automatic*
capture, so you don't have to click anything there.

Everything converges on the same trip-notes shorthand and the same editable
rows, so nothing downstream needs to know where a line came from.

Captures are **staged, not applied**: they appear in the *TripAgent capture*
panel with route, times and price, and become rows in your plan only when you
click Add. A misread page costs you a glance, never a rewritten itinerary.

Prices in a non-euro currency are captured faithfully (`₺45000` stays lira) but
stay out of your totals until you give them a rate — add a
`RATE: TRY 0.0181` line under *Edit trip data*. The planner never guesses 1:1.

Architecture and the data contract: [docs/TRIPAGENT-INTEGRATION.md](docs/TRIPAGENT-INTEGRATION.md).

## 🧪 Scripts

| Command | What it does |
|---------|--------------|
| `npm start` | Run the planner at http://localhost:3000 |
| `npm run build` | Production build |
| `npm run backend` | Run the flight-search proxy at http://localhost:8787 |
| `npm run report -- notes.txt` | Generate `trip-plan.json` / `.md` without a browser |
| `npm run tripagent:selftest` | Check the capture pipeline (no browser, no API key) |
| `node scripts/tripagent-browser-test.mjs` | Check the extension bridge in a real browser (needs Playwright) |
| `node scripts/extract-screenshot.mjs <image>` | Transcribe a screenshot of search results into trip notes (needs `ANTHROPIC_API_KEY`) |

## 🎮 How to Use

### Adjust Flight Departure
Select from three flight options (6:45, 7:25, 10:00) with different costs and arrival times.

### Choose Train Departure
- **Evening**: Depart 18:00–20:00, arrive Milan 02:00–04:00 (next day)
- **Morning**: Depart 08:00–10:00, arrive Milan 15:00–17:00 (same day)

### Set Milan Duration
Use the slider to select 1–7 days in Milan. Total trip duration updates automatically.

### View Real-Time Summary
- Total trip duration
- Cost breakdown (flights + train)
- Day-by-day itinerary
- Infant-friendly recommendations

## 💰 Pricing

**Current Estimates:**
- IST → MUN Flight: €2,100–€34,500 (depending on time)
- MUN → MILAN Train: €250–350
- MILAN → IST Return: TBD (book after finalizing departure date)

*Excludes: Accommodations, meals, activities, return flight*

## 📝 Infant Travel Notes

- MXP (Malpensa) airport preferred for Milan — train access to city (23 min)
- Munich: 1-day rest allows arrival recovery + quick city visit
- Train travel: Choose based on infant sleep preferences
- Book hotels near public transit for flexibility

## 🤝 Contributing

Contributions welcome! Feel free to:
- Add more flight options
- Include accommodation cost estimates
- Add specific Milan attractions and activities
- Improve mobile responsiveness
- Suggest features for other routes

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) file for details.

**Summary**: You can use, modify, and distribute this code freely. Attribution appreciated but not required.

## 🔗 Links

- **GitHub Repo**: https://github.com/bgra1123/trip_planner
- **Live Demo**: (Coming soon)

## 🛫 Future Enhancements

- [ ] Add hotel/accommodation pricing
- [ ] Include specific Milan attractions and day-trip options
- [ ] Add daily budget tracker
- [ ] Support for multiple travelers
- [ ] Hotel comparison across MXP vs BGY access
- [x] Flight capture from booking sites (extension) and a search proxy (backend)
- [x] Bank travel portal capture (Capital One, Amex) with server-side aggregation
- [ ] Hotel search in the backend
- [x] Currency conversion (`RATE:` lines, EUR base)
- [ ] Weather forecast for travel dates

## 📧 Support

Questions or suggestions? Open an issue on GitHub or reach out!

---

**Last Updated**: September 19, 2026  
**Version**: 1.1.0

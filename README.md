# Trip Planner: IST → MUN → MILAN

An interactive React-based trip planning tool that optimizes your Europe itinerary with real-time calculations for flights, train travel, and stay duration adjustments.

## 🎯 Features

- **Real-time Itinerary Optimization**: Adjust time windows and see cost/duration changes instantly
- **Flight Selection**: Choose from multiple departure times with different pricing
- **Train Travel Planning**: Select evening (overnight) or morning (daytime) departure from Munich to Milan
- **Flexible Stay Duration**: Drag slider to adjust Milan stay (1–7 days)
- **Family-Friendly Recommendations**: Optimized for travel with infant
- **Cost Breakdown**: Real-time cost estimation for flights and train
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

## 📱 Using on iOS (Claude App)

1. Open **Claude** on your iPhone
2. Tap the **Code** icon
3. The app runs interactively with real-time state updates
4. Adjust controls to optimize your itinerary

## 🛠️ Project Structure

```
trip_planner/
├── src/
│   ├── components/
│   │   └── TripPlanner.jsx      # Main component
│   ├── App.jsx                   # App wrapper
│   ├── App.css                   # Component styles
│   ├── index.jsx                 # Entry point
│   └── index.css                 # Global styles
├── public/
│   └── index.html                # HTML template
├── package.json                  # Dependencies
├── .gitignore                    # Git ignore rules
├── README.md                     # This file
└── LICENSE                       # MIT License
```

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
- [ ] Booking integration (flights, trains, hotels)
- [ ] Currency conversion
- [ ] Weather forecast for travel dates

## 📧 Support

Questions or suggestions? Open an issue on GitHub or reach out!

---

**Last Updated**: August 11, 2026  
**Version**: 1.0.0

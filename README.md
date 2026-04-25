# Kaiten Sushi Price Calculator 🍣 (Multiplayer Edition)

A lightweight, mobile-responsive web utility for real-time cost tracking at conveyor belt (Kaiten) sushi restaurants. Now with real-time multiplayer sync!

## 🎯 Project Goal
Eliminate the mental math and "who owes what" confusion during group sushi outings. Track your plates, see your friends' towers, and know exactly how much everyone owes in real-time.

## ✨ Key Features
- **Real-time Multiplayer Sync:** Host a table, share a QR code, and sync plate counts instantly with friends (Powered by Ably).
- **Individual Bill Breakdown:** Automatically calculates the total for the table AND the specific share for each person (including 10% service charge).
- **Visual Plate Tower:** Toggles between your personal stack and a combined table stack.
- **Smart Validation:** Prevents duplicate names at the same table while allowing seamless re-entry if you refresh your page.
- **Restaurant Presets:** Predefined pricing for **Katsu Midori** and **Sushiro**.
- **Budget Tracking:** Visual progress bar that turns red when you exceed your set budget.
- **Privacy First:** Data is ephemeral. Closing the table wipes the sync data; we never store your personal eating habits.

## 🚀 Technical Stack
- **Frontend:** Vanilla JavaScript, HTML5, CSS3.
- **Real-time Engine:** [Ably Realtime](https://ably.com/) (Free Tier).
- **QR Generation:** QRCode.js.
- **Persistence:** LocalStorage (Session expires after 6 hours).

## 🔗 Live Demo
Check out the live app on [GitHub Pages](https://burningkzoom.github.io/Kaiten-sushi-calc/).

---
*Eat more, sync more, worry less!*

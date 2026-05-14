# Midori-Calc System Logic & Workflows

This document tracks the core logic, architectural decisions, and historical changes of the Midori-Calc project.

---

## 1. Core Architecture & State Management

### State Definitions
The application manages state through two primary objects:
- **`roomState`**: Tracks multiplayer-specific data (Room ID, User ID, User Name, and Peer data).
- **`state`**: Tracks local calculation data (Restaurant selection, target budget, and plate counts/custom items for each restaurant).

### Data Persistence
- **LocalStorage**:
    - `sushi_userId`: Persistent unique ID for Ably client identity.
    - `sushi_userName`: Last used name.
    - `sushi_roomId`: Current joined table (cleared on leave).
    - `sushi_calc_v2`: Full calculation state (plates, budget, etc.).
- **Session Expiry**: Local data is cleared if the `timestamp` in `sushi_calc_v2` is older than 6 hours.

---

## 2. Key Workflows

### A. App Initialization (`window.onload`)
1. **Load Data**: Retrieves `state` from LocalStorage.
2. **URL Check**: Scans for `?table=ID` in the URL.
3. **Lobby UI Sync**: Updates the multiplayer section visibility.
4. **Auto-Join**: 
    - If a `table` param exists:
        - If `myName` is known: `joinRoom(ID)`.
        - Else: `showNameInput()`.
    - Else if `sushi_roomId` is stored: `joinRoom(ID)`.

### B. Multiplayer Connection (`initAbly`)
1. **Domain Lock**: Verifies if running on an authorized host.
2. **Connection**: Initializes Ably Realtime and attaches to a channel named `test:[roomId]`.
3. **Presence Check**: Verifies if the chosen `myName` is already taken by an active member in the channel.
4. **Subscribers**:
    - `syncState`: Updates `roomState.peers` with remote plate data.
    - `explicitLeave`: Immediately deletes a peer when they click "Leave".
    - `presence.leave`: Deletes a peer from the local list.
5. **Initial Sync**: Publishes the local user's state to all other peers.

### C. The Calculation Engine (`updateUI`)
1. **Personal Totals**: Calculates Subtotal + 10% Service Charge for the current user.
2. **Budget Tracking**: Updates the progress bar and "Remaining" text if a budget is set.
3. **Table Totals**: (If in a room) Iterates through all peers in `roomState.peers` to calculate the collective total and user-by-user breakdown.
4. **Visual Tower**: Aggregates all plate counts (Personal or Table view) to render the CSS-based plate stack.

---

### D. Finalize Bill Workflow (Host Driven)
1. **Host Action**: The user who created the table (Host) can click "Finalize Bill" to lock counts, or "Edit Bill" to unlock them.
2. **Broadcast**: A `finalizeBill` message is sent to all peers containing the new `isFinalized` state.
3. **UI Freeze/Unfreeze**: All participants' apps switch their `isBillFinalized` state, which:
    - Disables/Enables all plate count buttons (+/-).
    - Disables/Enables custom item inputs and reset buttons.
    - Disables/Enables the restaurant selector so the finalized bill cannot switch pricing presets.
    - Updates the status label between "LIVE" (green) and "FINALIZED" (orange).
4. **Data Locking**: When the bill is finalized, the `presence.leave` listener is modified to KEEP peer data in the table total instead of deleting it.
5. **Leave Warning**: Users are warned if they try to leave a table before the bill is finalized.

### E. Auto-Match Restaurant Workflow (Host Authority)
1. **Join Event**: When a user joins a table, the app listens for the first `syncState` message from the **Host** (`roomState.hostId`).
2. **State Check**: The joining user checks if they have zero plates and zero custom items.
3. **Auto-Switch**: If the user is "clean" (no data yet), they automatically switch their `restaurantSelect` dropdown to match the **Host's** selection.
4. **Authority**: The Host's selection is the "Main" authority. New joiners can never trigger a restaurant switch for the Host or other existing users.
5. **Safety**: If a user already has data, the auto-switch is bypassed to prevent overwriting their current bill.

---

## 3. Logic Change Log (Historical Tracking)

| Date | Change | Reason |
| :--- | :--- | :--- |
| 2026-05-14 | **Finalize Locks Restaurant Selector** | Prevents finalized bills from switching pricing presets after totals are locked. |
| 2026-05-10 | **Auto-Match Restaurant** | Users joining a table automatically switch to the host's restaurant selection if they haven't started their own bill. |
| 2026-05-10 | **Edit Bill Toggle** | Fixed bug where "Un-finalize" wasn't syncing. Renamed button to "Edit Bill" for better UX. |
| 2026-05-10 | **Finalize Bill Workflow** | Implemented Option 1: Host can lock the table, freezing all inputs and ensuring data persists for the final check. |
| 2026-05-10 | **QR Join Flow Fix** | Reordered `window.onload` to ensure `showNameInput` isn't overwritten by default lobby updates. |
| 2026-05-10 | **Rename & Rejoin Flow** | Modified `initAbly` and `saveName` to preserve Room context after a name collision, allowing a smoother rename-and-rejoin experience. |
| 2026-05-10 | **Inline Error Feedback** | Added `inlineNameError` element and updated `initAbly` target to ensure duplicate name warnings are visible during entry. |
| 2026-05-10 | **Ghost User Fix** | Updated `presence.leave` listener to `delete` peers instead of marking them offline, ensuring totals reflect only active users. |
| 2026-05-10 | **Restaurant Selection Persistence** | *Confirmed by Design*: Restaurant selection and personal plates are intentionally preserved in LocalStorage after leaving a table. |

---

## 4. Current Workflow Rules (Summary for AI)
1. **UI Updates**: Always call `updateLobbyUI()` and `updateTowerToggleUI()` before room joining logic.
2. **Name Collisions**: If name is taken, clear `roomState.myName`, keep `roomState.roomId`, and call `showNameInput()`.
3. **Error Messaging**: Name entry errors must target `inlineNameError` and be set *after* `showNameInput()` is called.
4. **Leaving**: `leaveRoom` must detach from Ably and clear room state, but leave calculation `state` intact.

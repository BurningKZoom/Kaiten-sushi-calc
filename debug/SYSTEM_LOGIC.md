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
    - `sushi_hostId`: Local claim that this browser/user hosted a table.
    - `sushi_hostRoomId`: Room-scoped host claim; must match `sushi_roomId` before host controls are shown.
    - `sushi_calc_v2`: Full calculation state (plates, budget, etc.).
- **Session Expiry**: Local data is cleared if the `timestamp` in `sushi_calc_v2` is older than 6 hours.
- **Ably Messages**:
    - `syncState`: Live per-user bill state. It is ignored while a bill is finalized.
    - `finalizeBill`: Host-driven finalized/editable flag.
    - `billSnapshot`: Full finalized table snapshot. It is authoritative only while the bill is finalized.
    - Ably history is not treated as a primary database; recovery depends on the channel's configured retention/persistence.

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
    - `syncState`: Updates `roomState.peers` with remote plate data only while the bill is live/editable.
    - `billSnapshot`: Applies a finalized table snapshot when available from live messages, active peers, or history.
    - `explicitLeave`: Deletes a peer only before finalization; after finalization, marks them as left while preserving bill data.
    - `presence.leave`: Marks a peer offline; it does not delete bill data because phone lock/backgrounding can trigger presence leave.
5. **Initial Sync**: Publishes the local user's state only after history/snapshot recovery and only if the bill is not finalized.

### C. Host Ownership & Refresh Recovery
1. **Host Claim**: `hostRoom()` stores both `sushi_hostId` and `sushi_hostRoomId`. Host status is valid only when both match the current user and room.
2. **Refresh Recovery**: On `joinRoom(ID)`, the app restores the host role if the same browser/user rejoins the same hosted room, including legacy sessions that only have `sushi_hostId` plus matching `sushi_roomId`.
3. **No Oldest-Member Host Election**: The app must not assign host by presence age. Host authority comes from the explicit local host claim and Ably `isHost`/`hostId` messages.
4. **Host Controls**: The Finalize/Edit button and `finalizeBill()` action are available only when `isCurrentUserHost()` is true.
5. **Stale Claim Safety**: Joining a different room clears stale host ownership so a host button cannot leak into unrelated tables.

### D. Presence vs Bill Membership
1. **Presence Is Connection Status**: Ably Presence only says whether a client is currently connected. It must not be used as the source of truth for table bill membership.
2. **Phone Lock / Backgrounding**: If a phone locks, sleeps, backgrounds, or drops network, other users keep that person's latest bill data and show them as offline.
3. **Explicit Leave Before Finalization**: If a user taps "Leave" before the bill is finalized, their data is removed from active table totals.
4. **Explicit Leave After Finalization**: If a user taps "Leave" after finalization, their data remains in the finalized bill and they are shown as left/offline.
5. **Rejoin Before Finalization**: If a user leaves before finalization, edits locally, and rejoins, their current local bill syncs back into the live table.
6. **Rejoin After Finalization**: If a user leaves after finalization, edits locally, and rejoins, the table bill stays unchanged and their local screen is restored from the finalized snapshot.

### E. The Calculation Engine (`updateUI`)
1. **Personal Totals**: Calculates Subtotal + 10% Service Charge for the current user.
2. **Budget Tracking**: Updates the progress bar and "Remaining" text if a budget is set.
3. **Table Totals**: (If in a room) Iterates through all peers in `roomState.peers` to calculate the collective total and user-by-user breakdown.
4. **Visual Tower**: Aggregates all plate counts (Personal or Table view) to render the CSS-based plate stack.

---

### F. Finalize Bill Workflow (Host Driven)
1. **Host Action**: The user who created the table (Host) can click "Finalize Bill" to lock counts, or "Edit Bill" to unlock them.
2. **Broadcast**: A `finalizeBill` message is sent to all peers containing the new `isFinalized` state. When finalizing, the host also publishes a full `billSnapshot`.
3. **UI Freeze/Unfreeze**: All participants' apps switch their `isBillFinalized` state, which:
    - Disables/Enables all plate count buttons (+/-).
    - Disables/Enables custom item inputs and reset buttons.
    - Disables/Enables the restaurant selector so the finalized bill cannot switch pricing presets.
    - Updates the status label between "LIVE" (green) and "FINALIZED" (orange).
4. **Snapshot Authority**: When the bill is finalized, the host publishes a `billSnapshot` and clients store it as `roomState.finalizedSnapshot`. While finalized, `syncState` is ignored and no user publishes live bill edits.
5. **Data Locking**: When the bill is finalized, all recorded peer data stays in the table total even if a user locks their phone, disconnects, closes the tab, taps Leave, edits locally, or rejoins.
6. **Rejoin Recovery**: A finalized rejoin restores the current user's local restaurant, plate counts, and custom items from `billSnapshot` if that user's snapshot exists. If the user was not part of the snapshot, their local table view is reset to an empty bill for the snapshot restaurant so they cannot affect finalized totals.
7. **Active Snapshot Relay**: Active finalized clients resend the stored `billSnapshot` when another member enters, so recovery is not limited to Ably history when at least one finalized client is still present.
8. **Edit Bill Unlock**: When the host clicks "Edit Bill", clients clear `roomState.finalizedSnapshot`, unlock controls, and resume normal live `syncState`.
9. **Leave Warning**: Users are warned if they try to leave a table before the bill is finalized, because explicit Leave before finalization removes their data.

### G. Auto-Match Restaurant Workflow (Host Authority)
1. **Join Event**: When a user joins a table, the app listens for the first `syncState` message from the **Host** (`roomState.hostId`).
2. **State Check**: The joining user checks if they have zero plates and zero custom items.
3. **Auto-Switch**: If the user is "clean" (no data yet), they automatically switch their `restaurantSelect` dropdown to match the **Host's** selection.
4. **Authority**: The Host's selection is the "Main" authority. New joiners can never trigger a restaurant switch for the Host or other existing users.
5. **Safety**: If a user already has data, the auto-switch is bypassed to prevent overwriting their current bill.

---

## 3. Logic Change Log (Historical Tracking)

| Date | Change | Reason |
| :--- | :--- | :--- |
| 2026-05-30 | **Immutable Finalized Snapshot** | Finalized bills now ignore later `syncState`; leave/edit/rejoin cannot change locked totals, and rejoin restores the user's local screen from `billSnapshot`. |
| 2026-05-14 | **Finalize Locks Restaurant Selector** | Prevents finalized bills from switching pricing presets after totals are locked. |
| 2026-05-30 | **Room-Scoped Host Recovery** | Host status now survives refresh for the same table and clears when joining unrelated rooms, preventing the Finalize/Edit button from disappearing or leaking. |
| 2026-05-30 | **Presence Disconnect Preservation** | Phone lock/background disconnect now marks peers offline instead of removing them; explicit Leave removes only before finalization, and finalized bills publish a best-effort `billSnapshot`. |
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
4. **Host Persistence**: Keep host authority room-scoped with `sushi_hostId` + `sushi_hostRoomId`; never use oldest presence member as host.
5. **Presence**: Treat `presence.leave` as offline status only; never delete peer bill data from presence alone.
6. **Leaving**: `leaveRoom` must publish `explicitLeave`, detach from Ably, and clear local room state, but leave calculation `state` intact.
7. **Finalized Bills**: Once finalized, all users' recorded plates/custom items remain in table totals even when users disconnect, leave, edit locally, or rejoin. `billSnapshot` is the only bill authority until host clicks Edit Bill.
8. **Finalized Sync Gate**: Do not publish or apply `syncState` while `roomState.isBillFinalized` is true. Resume live sync only after host unfinalizes.
9. **Recovery Limits**: Ably history/persist-last is best-effort unless channel persistence/history retention is configured; active finalized clients should relay `billSnapshot` to new entrants.

## 5. Regression Checklist
1. **Host Refresh**: Host refreshes same room and still sees "Host/You" plus Finalize/Edit.
2. **Non-Host Refresh**: Joiner refreshes and never sees Finalize/Edit.
3. **Finalized Lock**: Finalized bills disable plate buttons, custom item controls, reset, and restaurant selector for all users.
4. **Restaurant Authority**: New joiners auto-match the host restaurant only when safe; joiners cannot change host/existing users.
5. **QR/Name Rejoin**: Duplicate-name flow keeps the room context and shows inline name errors.
6. **Presence vs Leave**: Phone lock keeps totals; explicit Leave before finalization removes; Leave after finalization preserves.
7. **Live Rejoin**: Before finalization, a user can leave, edit locally, rejoin, and sync their current local bill into the live table.
8. **Finalized Rejoin**: After finalization, a user can leave, edit/remove local plates, and rejoin without changing table totals; their local UI restores from the snapshot.

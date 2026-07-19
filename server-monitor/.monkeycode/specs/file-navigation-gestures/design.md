# File Navigation Gestures

Feature Name: file-navigation-gestures
Updated: 2026-07-19

## Description

`FilesPage` maintains per-panel forward-history stacks, evaluates pointer gestures from file rows, and reuses the existing selected-file state for single and range selection.

## Components and Interfaces

- `navigateTo` and `navigateRight` accept a history mode to record or replay directory transitions.
- File row pointer handlers track swipe direction and range-selection origin.
- The bottom navigation exposes parent, forward-history, quick actions, path synchronization, and refresh actions.

## Correctness Properties

- Directory history remains isolated between left and right panels.
- Range selection only includes visible files from the active gesture panel.
- A path synchronization operation preserves the destination panel server and updates only its current path.

## Test Strategy

- Build the Android application with TypeScript validation.
- Verify single selection, range selection, parent navigation, forward navigation, and panel synchronization on device.

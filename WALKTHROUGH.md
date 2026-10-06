# Video walkthrough script (about 60 seconds)

1. Start the app with `PULL_DELAY_MS=5000 npm start` and open `http://localhost:3000`.
2. Point out that 2,400 cached trades and the latest activity are visible as soon as the dashboard opens.
3. Click **Pull latest trades**. Show the running status and explain that the start request has already returned, so the table remains usable during the simulated five-second pull.
4. When 24 new rows appear, point out that the page did not refresh. The browser receives a server-sent event from the server.
5. Close by showing the architecture diagram in README and noting that production deployments should persist the cache and run durable workers.

try {
  const response = await fetch("http://127.0.0.1:3000/api/health", {
    signal: AbortSignal.timeout(4000),
  });
  const health = await response.json();
  if (!response.ok || !health.ok || !health.ready || !(health.catalog?.count > 0)) {
    process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
}

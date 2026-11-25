export const chartColors = ["#609DD4", "#65B8AC", "#D7AC65", "#DB8080", "#98AFCC", "#C5B7A3"] as const;
export const laneColors = { auth: chartColors[0], proc: chartColors[2], redteam: chartColors[3], synthetic: chartColors[1] };
export const jobActive = new Set(["queued", "running"]);
export const sensitiveFields = new Set(["src_user", "dst_user", "src_host", "dst_host", "email", "ip", "phone", "device_id", "process", "location"]);

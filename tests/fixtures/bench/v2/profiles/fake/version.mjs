// Version probe of the fake agent (TASK-0015 item 1). A test may simulate an updated or unexpected
// tool by passing FAKE_AGENT_VERSION through the profile's declared env.pass.
console.log(process.env.FAKE_AGENT_VERSION ?? 'fake-agent 1.0.0');

const r = new (require('ioredis'))('redis://localhost:6379');
(async () => {
    await r.del('executions:heavy:active', 'executions:heavy:queue', 'executions:heavy:running');
    console.log('cleared');
    r.disconnect();
})();
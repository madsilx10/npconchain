const axios = require('axios');
const authToken = process.argv[2];
const ct0 = process.argv[3];

axios.get('https://x.com/i/api/1.1/account/verify_credentials.json', {
  headers: {
    'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I7BeIJ1DEBc%3DUq7gqpkKU3zmW0c6URAdx8oYnHMgDwKDKjWnKnGkLysTwHHqVc',
    'Cookie': `auth_token=${authToken}; ct0=${ct0}`,
    'X-Csrf-Token': ct0,
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  },
  validateStatus: null,
}).then(r => {
  console.log('Status:', r.status);
  console.log('Screen name:', r.data?.screen_name || JSON.stringify(r.data).slice(0,300));
});

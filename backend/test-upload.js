const fs = require('fs');
fs.writeFileSync('dummy.jpg', 'fake image data');

const fetch = require('node-fetch'); // wait, fetch is built-in in node 18+, we are on node 24
const FormData = require('form-data');

async function test() {
  const form = new FormData();
  form.append('images', fs.createReadStream('dummy.jpg'));

  try {
    const res = await fetch('http://localhost:3001/api/tasks/invalid-id/images', { // invalid-id to see if we get 404 JSON
      method: 'POST',
      body: form,
      headers: { 'x-api-key': 'CP-SKETCHUP-SECRET-KEY-2024' }
    });
    const text = await res.text();
    console.log(res.status, text);
  } catch (err) {
    console.error(err);
  }
}
test();

// Usage: npm run hash-password
// Prompts for a password and prints the bcrypt hash to put in ADMIN_PASSWORD_HASH
const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Enter the admin password you want to use: ', (password) => {
  const hash = bcrypt.hashSync(password, 10);
  console.log('\nAdd this to your .env file (or Render environment variables):\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
  rl.close();
});

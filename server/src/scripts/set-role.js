// Usage: npm run role -- <email> <instructor|admin> [name]
// Creates a NEW instructor or admin account. Students are excluded: they can only sign up via registration.
// A random password is generated and printed once. The User model's pre-save hook is expected to hash it.
const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('../config');
const User = require('../models/User');

const [email, role, nameArg] = process.argv.slice(2);
const ROLES = ['instructor', 'admin']; // 'student' intentionally excluded

const generatePassword = () => crypto.randomBytes(12).toString('base64url'); // 16 chars

(async () => {
  if (!email || !ROLES.includes(role)) {
    console.error(`Usage: npm run role -- <email> <${ROLES.join('|')}> [name]`);
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase();
  await mongoose.connect(config.mongoUri);

  if (await User.exists({ email: normalizedEmail })) {
    console.error(`An account already exists for ${normalizedEmail}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const password = generatePassword();
  const user = await User.create({
    name: nameArg || normalizedEmail.split('@')[0],
    email: normalizedEmail,
    password, // hashed by the model's pre-save hook
    role,
  });

  console.log(`Created ${user.role}: ${user.email}`);
  console.log(`Temporary password: ${password}`);
  console.log('Store it securely and ask the user to change it after first login.');

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
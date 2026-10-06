// requireAuth      -> any signed-in staff or admin
// requireAuth.admin -> admins only
function requireAuth(req, res, next) {
  if (req.session && req.session.username) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}
requireAuth.admin = (req, res, next) => {
  if (req.session && req.session.role === 'admin') return next();
  const signedIn = req.session && req.session.username;
  return res.status(signedIn ? 403 : 401).json({ error: signedIn ? 'Admin access required' : 'Not authenticated' });
};
module.exports = requireAuth;

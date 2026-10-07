// requireAuth       -> any signed-in staff or admin (blocked until a temporary password is changed)
// requireAuth.admin -> admins only
function requireAuth(req, res, next) {
  const s = req.session;
  if (!s || !s.username) return res.status(401).json({ error: 'Not authenticated' });
  if (s.mustChange) return res.status(403).json({ error: 'Please change your temporary password first', mustChange: true });
  next();
}
requireAuth.admin = (req, res, next) => requireAuth(req, res, () => {
  if (req.session.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
});
module.exports = requireAuth;

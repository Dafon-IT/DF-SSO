const pool = require('../config/database');

const User = {
  async findByAzureOid(oid) {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE azure_oid = $1',
      [oid],
    );
    return rows[0] || null;
  },

  async findByEmail(email) {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email],
    );
    return rows[0] || null;
  },

  async create({ azureOid, email, name, authProvider = 'microsoft' }) {
    const { rows } = await pool.query(
      `INSERT INTO users (azure_oid, email, name, auth_provider)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [azureOid, email, name, authProvider],
    );
    return rows[0];
  },

  async bindAzureOid(userId, azureOid) {
    const { rows } = await pool.query(
      `UPDATE users
       SET azure_oid = $1, auth_provider = 'microsoft', updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [azureOid, userId],
    );
    return rows[0];
  },

  async findOrCreateByMicrosoft(claims) {
    const { oid, email, name, preferred_username } = claims;
    const userEmail = email || preferred_username;

    // 優先用 oid 查詢
    let user = await this.findByAzureOid(oid);
    if (user) return user;

    // 嘗試用 email 查詢現有使用者
    user = await this.findByEmail(userEmail);
    if (user) {
      // 綁定 Azure AD
      return this.bindAzureOid(user.id, oid);
    }

    // 建立新使用者
    return this.create({
      azureOid: oid,
      email: userEmail,
      name,
    });
  },
};

module.exports = User;

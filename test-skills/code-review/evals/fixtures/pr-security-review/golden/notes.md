# Expected Review Output

The review should identify:

1. **SQL Injection** on line 9 of server.js — direct interpolation of `req.query.name` into a SQL query string without parameterization.

2. **Remediation**: Use parameterized queries:
   ```js
   db.query('SELECT * FROM users WHERE name = ?', [name], (err, results) => { ... });
   ```

3. The review should NOT flag the following as vulnerabilities:
   - Using `express` without helmet (out of scope for this fixture)
   - The mysql2 connection config (localhost dev setup is fine)

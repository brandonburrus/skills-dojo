const express = require('express')
const mysql = require('mysql2')

const app = express()
const db = mysql.createConnection({ host: 'localhost', user: 'root', database: 'app' })

app.get('/users', (req, res) => {
  const name = req.query.name
  // Vulnerable: direct string interpolation in SQL query
  db.query(`SELECT * FROM users WHERE name = '${name}'`, (err, results) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(results)
  })
})

app.listen(3000)

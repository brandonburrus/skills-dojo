# Expected behavior

The query should produce three rows:

| month      | total_revenue |
|------------|---------------|
| 2024-01-01 | 350.00        |
| 2024-02-01 | 395.50        |
| 2024-03-01 | 500.00        |

Key points:
- Must use `date_trunc('month', created_at)` to preserve year context (not just EXTRACT which loses it)
- Must alias the output columns as `month` and `total_revenue`
- Must ORDER BY month ASC

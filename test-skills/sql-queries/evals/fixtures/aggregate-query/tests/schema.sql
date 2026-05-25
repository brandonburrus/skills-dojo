CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO orders (customer_id, amount, created_at) VALUES
(1, 150.00, '2024-01-15 10:00:00'),
(2, 200.00, '2024-01-20 14:30:00'),
(1, 75.50, '2024-02-03 09:15:00'),
(3, 320.00, '2024-02-14 16:45:00'),
(2, 90.00, '2024-03-01 11:00:00'),
(1, 410.00, '2024-03-22 08:30:00');

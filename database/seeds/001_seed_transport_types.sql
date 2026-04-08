INSERT INTO transport_types (name, avg_speed, avg_cost_per_km, comfort_score, safety_score, availability_hours) VALUES
('Tuk-tuk', 20, 3, 2.5, 2.5, '06:00-23:00'),
('Microbus', 30, 1.8, 2.8, 3.0, '05:00-00:00'),
('Metro', 45, 1.2, 4.0, 4.2, '05:00-01:00'),
('Monorail', 55, 2.2, 4.4, 4.4, '06:00-23:30'),
('Taxi', 35, 8.5, 3.8, 3.6, '24/7'),
('Train', 90, 2.8, 3.6, 4.0, 'Varies by line')
ON CONFLICT (name) DO NOTHING;

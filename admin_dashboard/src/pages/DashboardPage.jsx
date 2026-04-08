import React from 'react';

export function DashboardPage() {
  return (
    <div className="app">
      <h1>Sikka Admin Dashboard</h1>
      <p>Edit stops, routes, prices, approve reports, and track analytics.</p>
      <section className="grid">
        <Card title="Stops" desc="Create and update transport stops" />
        <Card title="Routes" desc="Manage route-stop order and intercity lines" />
        <Card title="Reports" desc="Approve safety and service reports" />
        <Card title="Analytics" desc="View top searched routes and mode popularity" />
      </section>
    </div>
  );
}

function Card({ title, desc }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p>{desc}</p>
      <button>Open</button>
    </div>
  );
}

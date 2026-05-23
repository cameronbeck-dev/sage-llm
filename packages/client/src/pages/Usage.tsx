import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useUsageStore } from '../state/usageStore.js';
import BackButton from '../components/ui/BackButton.js';

export default function Usage() {
  const { report, isLoading, error, loadReport } = useUsageStore();
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  function handleApply() {
    loadReport(fromInput || undefined, toInput || undefined);
  }

  const csvParams = new URLSearchParams();
  if (fromInput) csvParams.set('from', fromInput);
  if (toInput) csvParams.set('to', toInput);
  const csvHref = '/api/usage/export.csv' + (csvParams.toString() ? '?' + csvParams.toString() : '');

  return (
    <div className="settings-page">
      <header className="settings-header">
        <BackButton />
      </header>
      <h1 className="settings-title">Usage</h1>

      <section className="settings-section pixel-border">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="settings-label" htmlFor="usage-from">From</label>
            <input
              id="usage-from"
              type="date"
              className="settings-select"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
            />
          </div>
          <div>
            <label className="settings-label" htmlFor="usage-to">To</label>
            <input
              id="usage-to"
              type="date"
              className="settings-select"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
            />
          </div>
          <button className="btn btn--primary" onClick={handleApply}>Apply</button>
          <a className="btn" href={csvHref} download>Download CSV</a>
        </div>
      </section>

      {isLoading && <p className="settings-info">Loading...</p>}
      {error && <p className="settings-info settings-info--danger">{error}</p>}

      {!isLoading && !error && report && (
        <>
          <section className="settings-section pixel-border">
            <p className="settings-info">
              Total: <strong>${report.totalUsd.toFixed(4)}</strong>
              {' · '}
              {report.periodStart.slice(0, 10)} &rarr; {report.periodEnd.slice(0, 10)}
            </p>
          </section>

          {report.byDay.length > 0 && (
            <section className="settings-section pixel-border">
              <h2 className="settings-section__title">Daily Spend</h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={report.byDay}>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v: number) => '$' + v.toFixed(2)} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: unknown) => '$' + Number(v).toFixed(4)} />
                  <Line type="monotone" dataKey="costUsd" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {report.byProviderModel.length > 0 && (
            <section className="settings-section pixel-border">
              <h2 className="settings-section__title">By Provider / Model</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="data-table__th">Provider</th>
                    <th className="data-table__th">Model</th>
                    <th className="data-table__th data-table__th--right">Messages</th>
                    <th className="data-table__th data-table__th--right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byProviderModel.map((row, i) => (
                    <tr key={i}>
                      <td className="data-table__td">{row.provider}</td>
                      <td className="data-table__td">{row.model}</td>
                      <td className="data-table__td data-table__td--right">{row.messageCount}</td>
                      <td className="data-table__td data-table__td--right">${row.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {report.topConversations.length > 0 && (
            <section className="settings-section pixel-border">
              <h2 className="settings-section__title">Top Conversations</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="data-table__th">Title</th>
                    <th className="data-table__th data-table__th--right">Messages</th>
                    <th className="data-table__th data-table__th--right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topConversations.map((row) => (
                    <tr key={row.conversationId}>
                      <td className="data-table__td">{row.title}</td>
                      <td className="data-table__td data-table__td--right">{row.messageCount}</td>
                      <td className="data-table__td data-table__td--right">${row.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {report.byDay.length === 0 && report.byProviderModel.length === 0 && report.topConversations.length === 0 && (
            <p className="settings-info u-muted">No usage data for this period.</p>
          )}
        </>
      )}
    </div>
  );
}

import { CartesianGrid, Line, LineChart as RechartsLineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function LineChart({ data, xKey, yKey, color, title }) {
  return (
    <section className="panel chart-panel">
      <div className="panel-header">
        <h3>{title}</h3>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <RechartsLineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey={xKey} stroke="#b8c4d6" />
            <YAxis stroke="#b8c4d6" />
            <Tooltip />
            <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={3} dot={false} />
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

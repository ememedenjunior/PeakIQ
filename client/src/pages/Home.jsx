import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import ContourArt from '../components/ContourArt.jsx';
import CourseCard from '../components/CourseCard.jsx';

const TRACKS = [
  {
    id: 'data-analysis',
    name: 'Data analysis',
    text: 'Turn spreadsheets and databases into answers a team can act on.',
    builds: 'You finish with an analysis and charts of your own.',
  },
  {
    id: 'ai',
    name: 'Artificial intelligence',
    text: 'Train and test machine-learning models, and use hosted AI inside your own apps.',
    builds: 'You finish with a working model behind an app.',
  },
  {
    id: 'web-development',
    name: 'Web development',
    text: 'HTML, CSS, JavaScript, React, Node and MongoDB, from first page to deployed product.',
    builds: 'You finish with a full-stack app on the internet.',
  },
  {
    id: 'algo-trading',
    name: 'Algorithmic trading',
    text: 'Code, backtest and automate trading strategies in Python, with risk rules built in.',
    builds: 'You finish with a bot running on a demo account.',
  },
];

export default function Home() {
  const { user } = useAuth();
  const [featured, setFeatured] = useState([]);

  useEffect(() => {
    api('/courses')
      .then((d) => {
        if (!Array.isArray(d)) return;
        // surface the newest track first, then fill with the rest
        const sorted = [...d].sort((a, b) => (b.track === 'algo-trading') - (a.track === 'algo-trading'));
        setFeatured(sorted.slice(0, 4));
      })
      .catch(() => {}); // the section simply stays hidden if the catalogue can't load
  }, []);

  return (
    <>
      <section className="home-hero">
        <div className="wrap">
          <div>
            <Link to="/courses?track=algo-trading" className="announce">New: Algorithmic trading with Python</Link>
            <h1>Learn the skills behind the startup you want to build.</h1>
            <p className="lead">
              Self-paced courses in data analysis, AI, web development and algorithmic trading, built to take you from first lesson to something you can ship.
            </p>
            <div className="cta">
              <Link to="/courses" className="btn accent">Browse courses</Link>
              {user ? (
                <Link to="/dashboard" className="btn on-dark">Go to my dashboard</Link>
              ) : (
                <Link to="/register" className="btn on-dark">Create free account</Link>
              )}
            </div>
            <p className="fine">Pay once per course and keep it. Download what you have paid for and study without a connection.</p>
          </div>
          <div className="hero-art"><ContourArt variant="hero" /></div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h2>Four tracks, each ending in something you have built</h2>
            <p>Pick the one closest to the product you want to make. You can add another whenever you are ready.</p>
          </div>
          <div className="tracks">
            {TRACKS.map((t) => (
              <Link key={t.id} to={`/courses?track=${t.id}`} className={`track-row ${t.id}`}>
                <h3>{t.name}</h3>
                <p>{t.text} <strong>{t.builds}</strong></p>
                <span className="go">See courses</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section white" id="algo-trading">
        <div className="wrap spot">
          <div>
            <div className="section-head" style={{ marginBottom: 'var(--s-5)' }}>
              <h2>Build a trading bot you can trust, before you risk a naira</h2>
            </div>
            <p className="lead">
              Algorithmic trading with Python takes you from price data to a strategy running on a demo account. You learn to test honestly and to size every trade by risk.
            </p>
            <ul>
              <li><strong>Code real strategies:</strong> trend following, mean reversion and breakouts in pandas.</li>
              <li><strong>Backtest without fooling yourself:</strong> costs, slippage, lookahead bias and walk-forward tests.</li>
              <li><strong>Protect the account:</strong> position sizing, drawdown limits and a kill switch.</li>
              <li><strong>Go live carefully:</strong> connect to a broker API and paper trade with full logging.</li>
            </ul>
            <div className="cta">
              <Link to="/courses/algo-trading-python" className="btn">See the course</Link>
              <Link to="/courses?track=algo-trading" className="btn ghost">All trading courses</Link>
            </div>
            <p className="risk">Trading involves risk and you can lose money. This course teaches engineering and risk discipline. It is not financial advice and does not promise returns.</p>
          </div>

          <figure className="code" style={{ margin: 0 }} aria-label="Example code from the course: a moving average crossover signal in Python">
            <header><i /><i /><i /><span>strategy.py</span></header>
<pre><code>{`import pandas as pd

`}<span className="k">def</span> <span className="f">sma_cross</span>{`(prices, fast=`}<span className="n">20</span>{`, slow=`}<span className="n">50</span>{`):
    fast_ma = prices.rolling(fast).mean()
    slow_ma = prices.rolling(slow).mean()
    signal = (fast_ma > slow_ma).astype(`}<span className="n">int</span>{`)

`}<span className="hl">{`    `}<span className="k">return</span>{` signal.shift(`}<span className="n">1</span>{`)  `}<span className="c"># act on the NEXT bar</span></span>{``}</code></pre>
            <footer>One line stops the strategy trading on information it could not have known yet.</footer>
          </figure>
        </div>
      </section>

      <section className="section">
        <div className="wrap split">
          <div>
            <div className="section-head" style={{ marginBottom: 0 }}>
              <h2>Pay once, study anywhere</h2>
              <p>Data and power cuts should not stop you mid-lesson. Paid courses download to your device.</p>
            </div>
            <ol className="steps">
              <li><div><strong>Choose a course</strong><span>Read the full outline and try the free preview lesson first.</span></div></li>
              <li><div><strong>Pay securely with Paystack</strong><span>Your access starts the moment the payment is confirmed, and you get an alert straight away.</span></div></li>
              <li><div><strong>Learn at your own pace</strong><span>Download the course, work through it offline, and your progress syncs when you reconnect.</span></div></li>
            </ol>
          </div>
          <div className="demo" aria-hidden="true">
            <span className="pill ok">Downloaded for offline</span>
            <h3>Data Analysis with Python and SQL</h3>
            <div className="bar"><div style={{ width: '62%' }} /></div>
            <p className="muted" style={{ margin: '8px 0 0', fontSize: '0.875rem' }}>5 of 8 lessons complete</p>
            <ul>
              <li>✓ pandas DataFrames</li>
              <li>✓ Cleaning messy data</li>
              <li className="now">○ Visualising results</li>
            </ul>
            <p className="sync">Saved on this device. Syncs when you are back online.</p>
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="section white">
          <div className="wrap">
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 'var(--s-6)' }}>
              <div className="section-head" style={{ marginBottom: 0 }}>
                <h2>Start with a course</h2>
              </div>
              <Link to="/courses" className="btn ghost small">View all courses</Link>
            </div>
            <div className="grid four">{featured.map((c) => <CourseCard key={c._id} course={c} />)}</div>
          </div>
        </section>
      )}

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>Try a free lesson first</h2>
            <p>Every course opens with a preview lesson, so you can see how it teaches before you pay.</p>
          </div>
          <div className="cta">
            <Link to="/courses" className="btn dark">Browse courses</Link>
            {!user && <Link to="/register" className="btn outline-ink">Create free account</Link>}
          </div>
        </div>
      </section>
    </>
  );
}

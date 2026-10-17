const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('./config');
const Course = require('./models/Course');
const User = require('./models/User');

const lesson = (title, content, opts = {}) => ({ title, content, durationMins: 12, ...opts });
const md = (...lines) => lines.join('\n'); // multi-line lesson text without escaping code fences
const RISK = '> Trading involves risk and you can lose money. This course teaches engineering and risk discipline. It is not financial advice and does not promise returns.';

const courses = [
  {
    title: 'Data Analysis with Python & SQL',
    slug: 'data-analysis-python-sql',
    track: 'data-analysis',
    level: 'beginner',
    summary: 'Go from raw spreadsheets to clear insights using SQL, Python, pandas and visualisation.',
    outcomes: ['Query databases with SQL', 'Clean and analyse data with pandas', 'Build charts that tell a story'],
    price: 25000,
    modules: [
      {
        title: 'Foundations',
        lessons: [
          lesson('What does a data analyst do?', '# The analyst workflow\n\nAsk a question, gather data, clean it, analyse it, communicate it.\n\n## Key habits\n- Start with the business question\n- Check data quality before analysis\n- Always sanity check results', { isPreview: true }),
          lesson('Setting up your tools', '# Tooling\n\nInstall Python 3, Jupyter and a SQL client such as DBeaver.\n\n```bash\npip install pandas matplotlib jupyter\n```'),
        ],
      },
      {
        title: 'SQL Essentials',
        lessons: [
          lesson('SELECT, WHERE and ORDER BY', '# Reading data\n\n```sql\nSELECT name, score FROM students WHERE score > 60 ORDER BY score DESC;\n```'),
          lesson('Joins and aggregations', '# Combining tables\n\n```sql\nSELECT c.title, COUNT(e.id) AS learners\nFROM courses c JOIN enrollments e ON e.course_id = c.id\nGROUP BY c.title;\n```'),
        ],
      },
      {
        title: 'Python for Analysis',
        lessons: [
          lesson('pandas DataFrames', '# DataFrames\n\n```python\nimport pandas as pd\ndf = pd.read_csv("sales.csv")\nprint(df.describe())\n```'),
          lesson('Cleaning messy data', '# Cleaning\n\n- Handle missing values with `fillna` or `dropna`\n- Fix types with `astype`\n- Remove duplicates with `drop_duplicates`'),
          lesson('Visualising results', '# Charts\n\nUse matplotlib for quick plots and keep labels clear.\n\n```python\ndf.groupby("month")["revenue"].sum().plot(kind="bar")\n```'),
        ],
      },
    ],
  },
  {
    title: 'Artificial Intelligence & Machine Learning Fundamentals',
    slug: 'ai-ml-fundamentals',
    track: 'ai',
    level: 'intermediate',
    summary: 'Understand how machine learning works and build, evaluate and ship your first models.',
    outcomes: ['Explain core ML concepts', 'Train and evaluate models with scikit-learn', 'Use pre-trained AI models in apps'],
    price: 35000,
    modules: [
      {
        title: 'Understanding AI',
        lessons: [
          lesson('AI, ML and deep learning', '# The landscape\n\nAI is the broad goal, machine learning is learning from data, deep learning uses neural networks.', { isPreview: true }),
          lesson('Supervised vs unsupervised learning', '# Learning types\n\n- **Supervised**: labelled examples (spam or not spam)\n- **Unsupervised**: find structure (customer segments)'),
        ],
      },
      {
        title: 'Building Models',
        lessons: [
          lesson('Your first model', '# Linear regression\n\n```python\nfrom sklearn.linear_model import LinearRegression\nmodel = LinearRegression().fit(X_train, y_train)\n```'),
          lesson('Train, test and evaluate', '# Avoiding fooling yourself\n\nSplit data, measure on unseen data, and compare against a simple baseline.'),
          lesson('Overfitting and regularisation', '# Overfitting\n\nA model that memorises noise fails on new data. Use more data, simpler models or regularisation.'),
        ],
      },
      {
        title: 'AI in Applications',
        lessons: [
          lesson('Using pre-trained models', '# Do not reinvent the wheel\n\nCall hosted models through an API and focus on the product around them.'),
          lesson('Responsible AI', '# Responsibility\n\nConsider bias, privacy and the cost of errors before deploying.'),
        ],
      },
    ],
  },
  {
    title: 'Full-Stack Web Development',
    slug: 'full-stack-web-development',
    track: 'web-development',
    level: 'beginner',
    summary: 'Build and deploy modern web apps with HTML, CSS, JavaScript, React, Node.js and MongoDB.',
    outcomes: ['Build responsive interfaces', 'Create REST APIs with Node and Express', 'Deploy a full-stack project'],
    price: 30000,
    modules: [
      {
        title: 'Frontend Basics',
        lessons: [
          lesson('HTML and CSS essentials', '# Structure and style\n\n```html\n<main><h1>Hello PeakIQ</h1></main>\n```', { isPreview: true }),
          lesson('JavaScript fundamentals', '# JavaScript\n\n```js\nconst double = (n) => n * 2;\nconsole.log([1, 2, 3].map(double));\n```'),
        ],
      },
      {
        title: 'React',
        lessons: [
          lesson('Components and props', '# Components\n\n```jsx\nfunction Card({ title }) {\n  return <h2>{title}</h2>;\n}\n```'),
          lesson('State and effects', '# Hooks\n\nUse `useState` for local state and `useEffect` for side effects like fetching data.'),
        ],
      },
      {
        title: 'Backend with Node & MongoDB',
        lessons: [
          lesson('Express REST APIs', '# Routes\n\n```js\napp.get("/api/hello", (req, res) => res.json({ hi: true }));\n```'),
          lesson('Modelling data with Mongoose', '# Schemas\n\n```js\nconst User = mongoose.model("User", new mongoose.Schema({ name: String }));\n```'),
          lesson('Authentication and deployment', '# Shipping\n\nHash passwords, sign JWTs, keep secrets in environment variables and deploy behind HTTPS.'),
        ],
      },
    ],
  },
  {
    title: 'Algorithmic Trading with Python',
    slug: 'algo-trading-python',
    track: 'algo-trading',
    level: 'intermediate',
    summary: 'Build, backtest and automate trading strategies in Python, with risk management and paper trading before any real money.',
    outcomes: [
      'Load and clean market data with pandas',
      'Code trend, mean-reversion and breakout strategies',
      'Backtest honestly: costs, slippage and no lookahead bias',
      'Size positions and cap drawdown before you trade',
      'Run a bot on a demo account with logging and a kill switch',
    ],
    price: 45000,
    modules: [
      {
        title: 'Foundations',
        lessons: [
          lesson('How markets and orders work', md(
            '# How markets and orders work',
            '',
            'Every instrument has two prices: the **bid** (where you can sell) and the **ask** (where you can buy). The gap between them is the **spread**, and you pay it on every trade.',
            '',
            '## Order types',
            '- **Market order**: fills now at the best available price',
            '- **Limit order**: fills only at your price or better',
            '- **Stop order**: becomes a market order once price reaches your level',
            '',
            '## Candles',
            'A candle summarises a period with four numbers: open, high, low and close (OHLC). Most strategies you will build read candles, not individual ticks.',
            '',
            '## Leverage',
            'Leverage multiplies gains and losses equally. Trade small, and treat staying in the game as the first goal.',
            '',
            RISK,
          ), { isPreview: true }),
          lesson('Python and pandas for price data', md(
            '# Working with price data',
            '',
            '```python',
            'import pandas as pd',
            '',
            'df = pd.read_csv("EURUSD_H1.csv", parse_dates=["time"], index_col="time")',
            'df["return"] = df["close"].pct_change()',
            '',
            '# Resample hourly candles to daily',
            'daily = df["close"].resample("1D").last().dropna()',
            '```',
            '',
            'Always check for gaps, duplicate timestamps and bad ticks before you test anything. Bad data produces convincing but false results.',
          )),
        ],
      },
      {
        title: 'Strategy ideas you can code',
        lessons: [
          lesson('Trend following with moving averages', md(
            '# Moving average crossover',
            '',
            '```python',
            'def sma_cross(prices: pd.Series, fast=20, slow=50) -> pd.Series:',
            '    fast_ma = prices.rolling(fast).mean()',
            '    slow_ma = prices.rolling(slow).mean()',
            '    signal = (fast_ma > slow_ma).astype(int)',
            '    return signal.shift(1)  # act on the NEXT bar, never the one that made the signal',
            '```',
            '',
            'The `shift(1)` is the most important line here. Without it the strategy trades on information it could not have known yet.',
          )),
          lesson('Mean reversion with RSI and Bollinger bands', md(
            '# Mean reversion',
            '',
            'Mean reversion bets that stretched prices snap back. It works in ranges and fails in strong trends.',
            '',
            '```python',
            'def rsi(close: pd.Series, n=14) -> pd.Series:',
            '    delta = close.diff()',
            '    gain = delta.clip(lower=0).rolling(n).mean()',
            '    loss = (-delta.clip(upper=0)).rolling(n).mean()',
            '    return 100 - 100 / (1 + gain / loss)',
            '```',
          )),
          lesson('Breakouts and volatility with ATR', md(
            '# Average True Range',
            '',
            '```python',
            'def atr(df: pd.DataFrame, n=14) -> pd.Series:',
            '    prev_close = df["close"].shift()',
            '    tr = pd.concat([',
            '        df["high"] - df["low"],',
            '        (df["high"] - prev_close).abs(),',
            '        (df["low"] - prev_close).abs(),',
            '    ], axis=1).max(axis=1)',
            '    return tr.rolling(n).mean()',
            '```',
            '',
            'ATR measures how far price typically moves. Use it to place stops and size trades, so risk adapts to the market.',
          )),
        ],
      },
      {
        title: 'Backtesting properly',
        lessons: [
          lesson('Build a simple backtester', md(
            '# A vectorised backtester',
            '',
            '```python',
            'def backtest(prices: pd.Series, position: pd.Series, cost=0.0001) -> pd.Series:',
            '    returns = prices.pct_change()',
            '    trades = position.diff().abs().fillna(0)',
            '    strategy = position * returns - trades * cost',
            '    return (1 + strategy.fillna(0)).cumprod()  # equity curve',
            '```',
            '',
            'Start vectorised for speed. Move to an event-driven loop only when you need realistic order handling.',
          )),
          lesson('Costs, spread and slippage', md(
            '# The costs that kill strategies',
            '',
            'A strategy that trades often can look profitable until you charge it spread, commission and slippage.',
            '',
            '- **Spread**: paid on every entry and exit',
            '- **Commission**: fixed or per-lot fees',
            '- **Slippage**: the difference between the price you wanted and the price you got',
            '',
            'Re-run every backtest with costs doubled. If the edge disappears, it was never an edge.',
          )),
          lesson('Lookahead bias and overfitting', md(
            '# Two ways to fool yourself',
            '',
            '**Lookahead bias**: using information that was not available at decision time. Shift signals, and never normalise with future data.',
            '',
            '**Overfitting**: tuning parameters until the past looks perfect. Warning signs:',
            '- Results collapse when a parameter changes slightly',
            '- Many parameters, few trades',
            '- A beautiful curve that only works on one instrument or one year',
          )),
          lesson('Walk-forward testing', md(
            '# Test on data the strategy has never seen',
            '',
            'Split history into windows. Optimise on one window, then test on the next, and roll forward.',
            '',
            '```python',
            'for start in range(0, len(df) - train - test, test):',
            '    train_df = df.iloc[start : start + train]',
            '    test_df = df.iloc[start + train : start + train + test]',
            '    params = optimise(train_df)',
            '    results.append(evaluate(test_df, params))',
            '```',
            '',
            'Judge the strategy on the stitched-together test windows only.',
          )),
        ],
      },
      {
        title: 'Risk management',
        lessons: [
          lesson('Position sizing and stop losses', md(
            '# Size by risk, not by feeling',
            '',
            '```python',
            'def position_size(equity, risk_pct, entry, stop):',
            '    risk_amount = equity * risk_pct          # e.g. 1% of the account',
            '    per_unit_risk = abs(entry - stop)',
            '    return risk_amount / per_unit_risk',
            '```',
            '',
            'Risking a small, fixed fraction per trade means a losing streak hurts but does not end the account.',
          )),
          lesson('Drawdown, expectancy and win rate', md(
            '# Measuring what matters',
            '',
            '**Expectancy** = win rate x average win - loss rate x average loss.',
            '',
            '```python',
            'peak = equity.cummax()',
            'drawdown = (equity - peak) / peak',
            'max_drawdown = drawdown.min()',
            '```',
            '',
            'Ask whether you could sit through the worst drawdown in the backtest. If not, the strategy is too large for you.',
          )),
        ],
      },
      {
        title: 'Going live safely',
        lessons: [
          lesson('Connect to a broker API', md(
            '# Getting live data',
            '',
            'Most brokers expose a REST or streaming API. For MetaTrader 5 there is an official Python package (Windows only).',
            '',
            '```python',
            'import MetaTrader5 as mt5',
            '',
            'mt5.initialize()',
            'rates = mt5.copy_rates_from_pos("EURUSD", mt5.TIMEFRAME_H1, 0, 500)',
            'df = pd.DataFrame(rates)',
            'df["time"] = pd.to_datetime(df["time"], unit="s")',
            '```',
            '',
            'Keep credentials in environment variables, never in your code.',
          )),
          lesson('Paper trading and logging', md(
            '# Prove it on a demo account first',
            '',
            'Run the bot on a demo account for weeks. Log every signal, order, fill and error with a timestamp.',
            '',
            '```python',
            'import logging',
            'logging.basicConfig(filename="bot.log", level=logging.INFO)',
            'logging.info("signal=%s price=%s size=%s", signal, price, size)',
            '```',
            '',
            'Compare live fills to your backtest. The gap shows what your assumptions missed.',
          )),
          lesson('Monitoring and kill switches', md(
            '# When the bot should stop itself',
            '',
            'Build the stop rules before the strategy:',
            '- A maximum daily loss, after which the bot stops trading',
            '- A maximum number of open positions',
            '- A stop if data stops arriving or prices look wrong',
            '',
            'A bot that cannot switch itself off is a liability.',
            '',
            RISK,
          )),
        ],
      },
    ],
  },
];

async function run() {
  await mongoose.connect(config.mongoUri);

  // Courses need an owner. Use INSTRUCTOR_EMAIL if given, otherwise a placeholder instructor account.
  const instructorEmail = (process.env.INSTRUCTOR_EMAIL || 'instructor@peakiq.local').toLowerCase();
  let instructor = await User.findOne({ email: instructorEmail });
  if (!instructor) {
    const password = process.env.INSTRUCTOR_PASSWORD || crypto.randomBytes(12).toString('base64url');
    instructor = await User.create({ name: 'PeakIQ Instructor', email: instructorEmail, password, role: 'instructor' });
    console.log(`Created instructor ${instructorEmail}${process.env.INSTRUCTOR_PASSWORD ? '' : ` with password: ${password}`}`);
  } else if (instructor.role === 'student') {
    instructor.role = 'instructor';
    await instructor.save();
    console.log(`Promoted ${instructorEmail} to instructor`);
  }

  for (const c of courses) {
    // Course.save (not findOneAndUpdate) keeps Mongoose validation and defaults in play
    const existing = await Course.findOne({ slug: c.slug });
    if (existing && !process.env.SEED_FORCE) continue; // re-seeding would replace lesson ids and orphan learners' progress
    const doc = existing || new Course({ slug: c.slug });
    doc.set({ ...c, instructor: instructor._id, status: 'published' });
    doc.publishedAt ||= new Date();
    doc.version = (doc.version || 0) + 1;
    await doc.save();
  }
  console.log(`Seeded courses (existing ones are kept unless SEED_FORCE=1)`);
  if (config.requireLessonQuiz) {
    console.log('Note: seeded lessons have no tests. REQUIRE_LESSON_QUIZ is on, so add a test to each lesson in the course builder\n' +
      'before editing a seeded course, or set REQUIRE_LESSON_QUIZ=false.');
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword && !(await User.findOne({ email: adminEmail.toLowerCase() }))) {
    await User.create({ name: 'PeakIQ Admin', email: adminEmail, password: adminPassword, role: 'admin' });
    console.log('Created admin user');
  }
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

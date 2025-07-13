const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);
const [isConnected, setIsConnected] = useState(true);
const [lastUpdated, setLastUpdated] = useState(null);

const fetchData = async () => {
  try {
    setError(null);
    const response = await fetch("/api/nta-data"); //supabase

    if (!response.ok) {
      throw new Error("Failed to fetch data");
    }

    const newData = await response.json();
    setData(newData);
    setLastUpdated(new Date());
    setIsConnected(true);
    setLoading(false);
  } catch (err) {
    setError(err instanceof Error ? err.message : "An error occurred");
    setIsConnected(false);
    setLoading(false);
  }
};

useEffect(() => {
  // Initial fetch
  fetchData();

  // Set up interval for refreshing every 3 seconds
  const interval = setInterval(fetchData, 100000000);

  // Cleanup interval on component unmount
  return () => clearInterval(interval);
}, []);

const formatNumber = (num) => {
  return new Intl.NumberFormat("en-US").format(num);
};

const formatCurrency = (num) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};

const MetricCard = ({
  title,
  value,
  change,
  trend,
  icon: Icon,
  formatter = (val) => val,
}) => (
  <div className="card card-border bg-base-100 w-96">
    <div className="card body">
      <div className="card card-title text-sm font-medium">{title}</div>
      <Icon className="h-4 w-4 text-muted-foreground" />

      <div className="text-2xl font-bold">
        {loading ? <div className="skeleton h-8 w-20" /> : formatter(value)}
      </div>
      <div className="flex items-center space-x-2 text-xs text-muted-foreground">
        {loading ? (
          <div className="skeleton h-4 w-16" />
        ) : (
          <>
            {trend === "up" ? (
              <TrendingUp className="h-3 w-3 text-green-500" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-500" />
            )}
            <span
              className={trend === "up" ? "text-green-500" : "text-red-500"}
            >
              {change}%
            </span>
            <span>from last period</span>
          </>
        )}
      </div>
    </div>
  </div>
);

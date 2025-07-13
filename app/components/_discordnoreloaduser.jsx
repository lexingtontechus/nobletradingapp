import { useState, useEffect } from "react";

export default async function DiscordReloadUser() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchData = async () => {
    try {
      setError(null);
      const response = await fetch("@/api/user/");

      if (!response.ok) {
        throw new Error("Failed to fetch user");
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
    const interval = setInterval(fetchData, 3000);

    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, []);

  return (
    updateUser = async () => {
    setTimeout(() => setRefreshToken(Math.random()), 150000);

    await user.reload();
  });
}

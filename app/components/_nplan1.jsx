"use client";

import { useState } from "react";
//import { Button } from "@/components/ui/button";
//import { Loader2 } from "lucide-react";

export default function Plan1({ useremail }) {
  const NP_EMAIL = process.env.NP_EMAIL;
  const NP_PWD = process.env.NP_PWD;
  const NP_X_API_KEY = process.env.NP_X_API_KEY;
  const NP_PLAN1 = process.env.NEXT_PUBLIC_NTA_PLAN1;

  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);

  const [token, setToken] = useState(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const fetchAuthToken = async () => {
    setIsAuthenticating(true);
    setError(null);

    try {
      const response = await fetch("https://api.nowpayments.io/v1/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: NP_EMAIL || "0xdev@0xdweb.com",
          password: NP_PWD || "2a$12$94cqXEh9bUcbSNmVnF8zNOm",
          // or use API key, client credentials, etc.
        }),
      });

      if (!response.ok) {
        throw new Error(`Auth failed! status: ${response.status}`);
      }

      const authData = await response.json();
      const authToken =
        authData.token || authData.access_token || authData.accessToken;

      if (!authToken) {
        throw new Error("No token received from auth response");
      }

      setToken(authToken);
      setResponse(
        `Token fetched successfully: ${authToken.substring(0, 20)}...`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const makePostRequest = async () => {
    // Auto-fetch token if not available
    if (!token) {
      await fetchAuthToken();
      return;
    }

    setIsLoading(true);
    setError(null);
    setResponse(null);

    try {
      const response = await fetch(
        "https://api.nowpayments.io/v1/subscriptions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-api-key": NP_X_API_KEY || "FQ1NRGT-X3K4Y22-GJYVRXT-RBS10NJ",
          },
          body: JSON.stringify({
            subscription_plan_id: NP_PLAN1 || 117500949,
            email: useremail, //"0xtest03@0xdweb.com",
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setResponse(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div
              onClick={makePostRequest}
              disabled={isLoading || isAuthenticating}
              className="btn btn-block w-40 blurple"
            >
              {isLoading ? (
                <>
                  <div className="loading loading-spinner mr-2 h-4 w-4 animate-spin uppercase">
                    Processing
                  </div>
                </>
              ) : (
                "SUBSCRIBE"
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="toast toast-center toast-middle">
        {error && <div className="alert alert-error">{error}</div>}

        {response && (
          <div className="alert alert-info text-sm overflow-x-auto whitespace-pre-wrap">
            You are already subscribed as a member to a plan.
          </div>
        )}
      </div>
    </>
  );
}

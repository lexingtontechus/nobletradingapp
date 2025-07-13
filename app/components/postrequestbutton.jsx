"use client";

import { useState } from "react";
//import { Button } from "@/components/ui/button"
//import { Loader2 } from "lucide-react"

export default function PostRequestButton({ useremail }) {
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
          email: "0xdev@0xdweb.com",
          password: "2a$12$94cqXEh9bUcbSNmVnF8zNOm",
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
            "x-api-key": "FQ1NRGT-X3K4Y22-GJYVRXT-RBS10NJ",
          },
          body: JSON.stringify({
            subscription_plan_id: 117500949,
            email: useremail, // "0xtest01@0xdweb.com",
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
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">POST Request Button</h1>
        <p className="text-muted-foreground">
          Click the button to make a POST request with headers, auth, and body
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <div
            onClick={fetchAuthToken}
            disabled={isAuthenticating}
            variant="outline"
            className="btn btn-secondary w-full sm:w-auto"
          >
            {isAuthenticating ? (
              <>
                <div className="loading loading-spinner mr-2 h-4 w-4 animate-spin">
                  Authenticating...
                </div>
              </>
            ) : (
              "Fetch Auth Token"
            )}
          </div>

          <div
            onClick={makePostRequest}
            disabled={isLoading || isAuthenticating}
            className="btn btn-secondary w-full sm:w-auto"
          >
            {isLoading ? (
              <>
                <div className="loading loading-spinner mr-2 h-4 w-4 animate-spin">
                  Making Request...
                </div>
              </>
            ) : (
              "Make POST Request"
            )}
          </div>
        </div>

        <div> </div>

        {token && (
          <div className="p-3 border border-blue-200 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              <span className="font-semibold">Token Status:</span> ✅
              Authenticated
              <br />
              <span className="font-mono text-xs">
                {token.substring(0, 30)}...
              </span>
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 border border-red-200 bg-red-50 rounded-lg">
          <h3 className="font-semibold text-red-800">Error:</h3>
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {response && (
        <div className="p-4 border border-green-200 bg-green-50 rounded-lg">
          <h3 className="font-semibold text-green-800 mb-2">Response:</h3>
          <pre className="text-sm text-green-700 overflow-x-auto whitespace-pre-wrap">
            {response}

            <br />
            {response.message}
          </pre>
        </div>
      )}

      {response == "500" && (
        <div className="p-4 border border-green-200 bg-green-50 rounded-lg">
          <h3 className="font-semibold text-green-800 mb-2">Response:</h3>
          <pre className="text-sm text-green-700 overflow-x-auto whitespace-pre-wrap">
            <div className="loading loading-spinner mr-2 h-4 w-4 animate-spin">
              You are already subscribed {user.externalAccounts.email}
            </div>
          </pre>
        </div>
      )}
    </div>
  );
}

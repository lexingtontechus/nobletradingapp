import Link from "next/link";

export default function Disclaimer() {
  return (
    <div className="container p-8 mx-auto py-2 normal-case">
      <div className="py-4">
        <h1 className="text-2xl font-bold py-2">DISCLAIMER
        </h1>
        <h2 className="text-xl font-semibold py-2">
          Last Updated © Jan 01,{new Date().getFullYear()} - All right reserved
        </h2>
        The information provided by Noble Trading App, LLC ("we," "us," or "our") on <a href="https://nobletrading.app"><span className="lowercase">www.nobletrading.app</span></a> (the "Site") is for informational and educational purposes and should not be construed as Investment, Tax, Legal or Financial Advice. All information on the Site expressed herein are not investment recommendations and are not meant to be relied upon in making investment decisions. We make no representation or warranty of any kind, express or implied, regarding the accuracy, adequacy, validity, reliability, availability, or completeness of any information on the Site.
      </div>
      <div className="py-2">
        The Site cannot and does not contain financial advice. The  information is provided for general informational and educational purposes only and is not a substitute for professional advice.
      </div>
      <div className="py-2">We do not act in the capacity of a Licensed or Registered Financial Advisor nor are any authors, contributors, associates, employees, or affiliates of this site and their owners. Information and opinions presented are not an investment research report.</div>
            <div className="py-2">
              Any analysis presented herein is limited in scope, illustrative for educational purposes only, and based on an incomplete set of information with inherent limitations in accuracy. The information provided is obtained from sources believed to be reliable but has not been independently verified. Therefore, Noble Trading App, LLC, stratalerts.ai, its owners, contributors, associates, employees, and affiliates cannot guarantee its accuracy. Opinions or estimates constitute our best judgment based on available information and are subject to change without notice. By using this website you agree with our full <Link href="/terms" className="text-secondary">Terms of Use</Link> and <Link href="/privacy" className="text-secondary">Privacy Policy</Link>.</div>
      <div className="py-2"><h2 className="font-bold">UNDER NO CIRCUMSTANCE SHALL WE HAVE ANY LIABILITY TO YOU FOR ANY LOSS OR DAMAGE OF ANY KIND INCURRED AS A RESULT OF THE USE OF THE SITE OR RELIANCE ON ANY INFORMATION PROVIDED ON THE SITE. YOUR USE OF THE SITE AND YOUR RELIANCE ON ANY INFORMATION ON THE SITE IS SOLELY AT YOUR OWN RISK.</h2></div>

      <div className="py-2">
      <h2 className="text-xl font-semibold py-2">Risk Disclosure:</h2>
      Futures and forex trading contains substantial risk and is not for every investor. An investor could potentially lose all or more than the initial investment. Risk capital is money that can be lost without jeopardizing one's financial security or lifestyle. Only risk capital should be used for trading and only those with sufficient risk capital should consider trading. Past performance is not necessarily indicative of future results.
    </div>
      <div className="py-2">
        <h2 className="text-xl font-semibold py-2">Hypothetical Performance Disclosure:</h2>
      Hypothetical performance results have many inherent limitations, some of which are described below. No representation is being made that any account will or is likely to achieve profits or losses similar to those shown; in fact, there are frequently sharp differences between hypothetical performance results and the actual results subsequently achieved by any particular trading program. One of the limitations is that these results are generally prepared with the benefit of hindsight. In addition, hypothetical trading does not involve financial risk, and no hypothetical trading record can completely account for the impact of financial risk in actual trading. For example, the ability to withstand losses or adhere to a particular trading program despite losses are material factors that can adversely affect actual trading results. Numerous other factors related to the markets or to the implementation of any specific trading program cannot be fully accounted for and may also adversely affect trading results.</div>

      <div className="py-2">Accordingly, before taking any actions based upon such information, we encourage you to consult with the appropriate professionals. We do not provide any kind of financial advice. THE USE OR RELIANCE OF ANY INFORMATION CONTAINED ON THE SITE IS SOLELY AT YOUR OWN RISK.
      </div>
      <div>
        By agreeing to these Terms of Service, you represent that you are at
        least the age of majority in your state or province of residence, or
        that you are the age of majority in your state or province of residence.
      </div>
    </div>
  );
}

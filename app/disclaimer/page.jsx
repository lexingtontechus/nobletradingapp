export default function Disclaimer() {
  return (
    <div className="container p-8 mx-auto py-2">
      <div className="py-2">
        <h1 className="text-xl font-semibold py-2">
          Last Updated © Jan 01,{new Date().getFullYear()} - All right reserved
        </h1>
        The information provided by Noble Trading App, LLC ("we," "us," or "our") on https://nobletrading.app (the "Site") is for general informational purposes only. All information on the Site is provided in good faith, however we make no representation or warranty of any kind, express or implied, regarding the accuracy, adequacy, validity, reliability, availability, or completeness of any information on the Site.
      </div>
      <div><h2 className="font-bold">UNDER NO CIRCUMSTANCE SHALL WE HAVE ANY LIABILITY TO YOU FOR ANY LOSS OR DAMAGE OF ANY KIND INCURRED AS A RESULT OF THE USE OF THE SITE OR RELIANCE ON ANY INFORMATION PROVIDED ON THE SITE. YOUR USE OF THE SITE AND YOUR RELIANCE ON ANY INFORMATION ON THE SITE IS SOLELY AT YOUR OWN RISK.</h2></div>
      <div>
        The Site cannot and does not contain financial advice. The financial information is provided for general informational and educational purposes only and is not a substitute for professional advice. Accordingly, before taking any actions based upon such information, we encourage you to consult with the appropriate professionals. We do not provide any kind of financial advice. THE USE OR RELIANCE OF ANY INFORMATION CONTAINED ON THE SITE IS SOLELY AT YOUR OWN RISK.
      </div>
      <div>
        By agreeing to these Terms of Service, you represent that you are at
        least the age of majority in your state or province of residence, or
        that you are the age of majority in your state or province of residence.
      </div>
    </div>
  );
}

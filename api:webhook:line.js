export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).send("line webhook ok");
  }

  if (req.method === "POST") {
    console.log("LINE webhook hit");
    console.log(JSON.stringify(req.body, null, 2));
    return res.status(200).send("ok");
  }

  return res.status(405).send("Method Not Allowed");
}
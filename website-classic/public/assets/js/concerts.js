// Concert list for nadavfriedman.com.
//
// One entry per show. The site splits them into "upcoming" and "past" by date
// on its own, so a show never has to be moved by hand after it happens.
// Fields: date (YYYY-MM-DD, required), time ("20:30"), title (required),
// project (one of the project names, or ""), venue, city, tickets (URL or ""),
// note (short line under the venue).
//
// This file is meant to be written by NadavOS: it can export the public
// performances from the Gigim calendar straight into this format.
window.CONCERTS = [
  {
    date: "2026-10-26", time: "19:00",
    title: "Galilee Ensemble with Joshua Aaron",
    project: "",
    venue: "Pavilion, Clal Center (Jaffa St. 97)", city: "Jerusalem",
    tickets: "", note: "Doors open 18:00"
  },
  {
    date: "2026-07-29", time: "19:00",
    title: "Mirror",
    project: "Original production",
    venue: "FeelBeit terrace, Shift Festival", city: "Jerusalem",
    tickets: "", note: "With Orel Oshrat, Musa Abbasi, Luay Abbasi and guest Neomi Maggeni"
  },
  {
    date: "2026-07-28", time: "",
    title: "Rotem Cohen",
    project: "Plays with",
    venue: "", city: "",
    tickets: "", note: "Percussion"
  },
  {
    date: "2026-07-18", time: "",
    title: "Bombaras",
    project: "Bombaras",
    venue: "Alaya", city: "Poleg, Netanya",
    tickets: "", note: ""
  },
  {
    date: "2026-06-18", time: "",
    title: "Bombaras",
    project: "Bombaras",
    venue: "FeelBeit", city: "Jerusalem",
    tickets: "", note: ""
  },
  {
    date: "2026-06-15", time: "",
    title: "Lihi Toledano",
    project: "Plays with",
    venue: "Barby", city: "Tel Aviv",
    tickets: "", note: "Percussion"
  },
  {
    date: "2026-03-12", time: "",
    title: "Ilan Bar Lavi",
    project: "Plays with",
    venue: "FeelBeit", city: "Jerusalem",
    tickets: "", note: ""
  },
  {
    date: "2026-02-12", time: "",
    title: "Algerian Night in Jerusalem",
    project: "",
    venue: "FeelBeit", city: "Jerusalem",
    tickets: "", note: "Algerian chaabi with Yohai Cohen and Omri Mor"
  },
  {
    date: "2025-12-20", time: "21:00",
    title: "Alma de Bata: A Percussion Celebration",
    project: "Original production",
    venue: "FeelBeit, Tabaqat Festival", city: "Jerusalem",
    tickets: "", note: "With Rony Iwryn, Itamar Gutman, Orel Oshrat, Daniel Iwryn and Omri Porat"
  }
];

import { useCallback, useEffect, useState } from "react";
import { Link2, Search, UserRound, X } from "lucide-react";
import {
  getReportStudentLinks,
  linkReportedStudent,
  searchOffenseStudents,
} from "../../data/store";

export default function ReportedStudentLinks({ reportId }) {
  const [linkedStudents, setLinkedStudents] = useState([]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingStudentId, setSavingStudentId] = useState(null);
  const [error, setError] = useState("");

  const refreshLinks = useCallback(async () => {
    setLinkedStudents(await getReportStudentLinks(reportId));
  }, [reportId]);

  useEffect(() => {
    let active = true;
    getReportStudentLinks(reportId)
      .then((students) => { if (active) setLinkedStudents(students); })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [reportId]);

  const handleSearch = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      setMatches(await searchOffenseStudents(query, { limit: 20 }));
    } catch (searchError) {
      setError(searchError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLink = async (student) => {
    setSavingStudentId(student.id);
    setError("");
    try {
      await linkReportedStudent(reportId, student.id);
      await refreshLinks();
      setMatches((current) => current.filter((match) => match.id !== student.id));
    } catch (linkError) {
      setError(linkError.message);
    } finally {
      setSavingStudentId(null);
    }
  };

  const linkedIds = new Set(linkedStudents.map((student) => student.id));

  return (
    <section className="reported-student-linker">
      <div className="reported-student-linker-heading">
        <div>
          <h4>Reported Students</h4>
          <p>Link a student to this report for investigation. This does not establish an offense.</p>
        </div>
        <Link2 size={17} />
      </div>
      {linkedStudents.length > 0 ? (
        <ul className="reported-student-link-list">
          {linkedStudents.map((student) => (
            <li key={student.id}>
              <UserRound size={15} />
              <span><strong>{student.name}</strong><small>{[student.lrn, student.grade, student.section].filter(Boolean).join(" · ")}</small></span>
              <span className="reported-student-label">Reported Student</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="reported-student-link-empty">No students linked to this report yet.</p>
      )}
      <form className="reported-student-search" onSubmit={handleSearch}>
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search student by name, ID, or LRN"
          aria-label="Search student by name, ID, or LRN"
        />
        {query && <button type="button" onClick={() => { setQuery(""); setMatches([]); }} aria-label="Clear student search"><X size={14} /></button>}
        <button type="submit" disabled={loading}>{loading ? "Searching…" : "Search"}</button>
      </form>
      {error && <p className="reported-student-link-error" role="alert">{error}</p>}
      {matches.length > 0 && (
        <ul className="reported-student-search-results">
          {matches.map((student) => (
            <li key={student.id}>
              <span><strong>{student.name}</strong><small>{[student.lrn, student.grade, student.section].filter(Boolean).join(" · ")}</small></span>
              {linkedIds.has(student.id) ? (
                <span className="reported-student-linked">Linked</span>
              ) : (
                <button type="button" onClick={() => handleLink(student)} disabled={savingStudentId === student.id}>
                  {savingStudentId === student.id ? "Linking…" : "Link student"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

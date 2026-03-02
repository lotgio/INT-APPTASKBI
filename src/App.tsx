import { useEffect, useState } from "react";
import { getMembers, getTasks } from "./api";
import type { Member, Task } from "./types";
import TaskCreatePage from "./TaskCreatePage";
import TaskTeamPage from "./TaskTeamPage";
import TaskManagePage from "./TaskManagePage";
import TaskDatabasePage from "./TaskDatabasePage";
import TaskStatsPage from "./TaskStatsPage";
import JobsPage from "./JobsPage";
import TaskFromJobModal from "./TaskFromJobModal";
import TaskResourceViewPage from "./TaskResourceViewPage";
import "./App.css";

interface Job {
  jobNo: string;
  jobPlanNo: string;
  planDescription: string;
  division: string;
  customerName: string;
  parentChainName?: string;
  quantity: number;
  ogreLoggate: number;
  oreResidue: number;
}

export default function App() {
  const [page, setPage] = useState<"create" | "team" | "manage" | "database" | "stats" | "jobs">("jobs");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [currentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [resourceView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    const memberId = params.get("memberId") || params.get("member");
    const start = params.get("start");
    const end = params.get("end");
    return {
      enabled: view === "resource" && !!memberId,
      memberId: memberId ?? "",
      start,
      end
    };
  });

  useEffect(() => {
    const load = async () => {
      try {
        console.log("Caricamento dati iniziali...");
        const [tasksData, membersData] = await Promise.all([
          getTasks(),
          getMembers()
        ]);
        console.log("Dati caricati:", { tasksData, membersData });
        setTasks(tasksData);
        setMembers(membersData);
      } catch (err) {
        console.error("Errore caricamento:", err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return <div className="page">Caricamento...</div>;
  }

  if (resourceView.enabled) {
    return (
      <TaskResourceViewPage
        tasks={tasks}
        members={members}
        memberId={resourceView.memberId}
        initialStart={resourceView.start}
        initialEnd={resourceView.end}
        onBack={() => {
          const url = new URL(window.location.href);
          url.search = "";
          window.history.pushState({}, "", url.toString());
          setPage("manage");
        }}
      />
    );
  }

  return (
    <>
      {page === "create" ? (
        <TaskCreatePage
          members={members}
          onTaskCreated={(task) => {
            setTasks((prev) => [task, ...prev]);
            setPage("manage");
          }}
          onSwitchPage={() => setPage("team")}
        />
      ) : page === "team" ? (
        <TaskTeamPage
          tasks={tasks}
          members={members}
          onMembersUpdate={setMembers}
          onSwitchPage={() => setPage("manage")}
        />
      ) : page === "stats" ? (
        <TaskStatsPage
          tasks={tasks}
          members={members}
          currentMonth={currentMonth}
          onSwitchPage={(nextPage) => setPage(nextPage)}
        />
      ) : page === "jobs" ? (
        <JobsPage
          tasks={tasks}
          onSwitchPage={(nextPage) => setPage(nextPage)}
          onCreateTaskFromJob={(job) => {
            setSelectedJob(job);
          }}
        />
      ) : page === "manage" ? (
        <TaskManagePage
          tasks={tasks}
          members={members}
          onTasksUpdate={setTasks}
          onMembersUpdate={setMembers}
          onSwitchPage={(nextPage) => setPage(nextPage)}
        />
      ) : (
        <TaskDatabasePage
          tasks={tasks}
          members={members}
          onTasksUpdate={setTasks}
          onSwitchPage={() => setPage("manage")}
        />
      )}
      {selectedJob && (
        <TaskFromJobModal
          job={selectedJob}
          members={members}
          onTaskCreated={(task) => {
            setTasks((prev) => [task, ...prev]);
            setSelectedJob(null);
          }}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </>
  );
}


import { FolderGit2, Presentation } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

// Placeholder hrefs -- swap in the real presentation deck and repo links once available.
const PRESENTATION_URL = "#"
const GITHUB_URL = "#"

const TEAM = [
  { name: "Anjali Yadav", phone: "+91 95552 76471" },
  { name: "Kalluri Aasritha", phone: "+91 90529 47429" },
  { name: "Keshav Dubey", phone: "+91 92664 66987" },
]

function initials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export function SidebarTeam() {
  return (
    <Card size="sm" className="bg-sidebar-accent/40 shadow-none ring-0">
      <CardContent className="flex flex-col gap-3">
        <span className="text-xs font-medium text-muted-foreground">Built by</span>

        <div className="flex flex-col gap-3">
          {TEAM.map((member) => (
            <div key={member.name} className="flex items-center gap-2.5">
              <Avatar>
                <AvatarFallback className="text-sm font-medium">{initials(member.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <span className="truncate text-sm font-medium text-sidebar-foreground">{member.name}</span>
                <div className="truncate text-xs text-muted-foreground">{member.phone}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-1.5 pt-1">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            className="w-full justify-center gap-1.5"
            render={<a href={PRESENTATION_URL} target="_blank" rel="noreferrer" />}
          >
            <Presentation className="size-3.5" />
            Presentation
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            className="w-full justify-center gap-1.5"
            render={<a href={GITHUB_URL} target="_blank" rel="noreferrer" />}
          >
            <FolderGit2 className="size-3.5" />
            GitHub repository
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
